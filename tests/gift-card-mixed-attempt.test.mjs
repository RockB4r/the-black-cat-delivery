import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reconcileExpiredGiftReservations } from '../netlify/lib/gift-cards.ts'

const orderId = '11111111-1111-4111-8111-111111111111'
const cardId = '22222222-2222-4222-8222-222222222222'
const checkoutId = '33333333-3333-4333-8333-333333333333'

test('mixed charge attempt is persisted before the external POST and ambiguous results are held', () => {
  const source = readFileSync(new URL('../netlify/functions/create-culqi-charge.ts', import.meta.url), 'utf8')
  const begin = source.indexOf('await beginMixedCulqiAttempt(')
  const charge = source.indexOf("await fetch('https://api.culqi.com/v2/charges'")
  assert.ok(begin > 0 && charge > begin)
  assert.match(source, /markMixedCulqiAttempt\(mixedAttemptId, 'rejected', 'culqi_http_4xx'\)/)
  assert.match(source, /markMixedCulqiAttempt\(mixedAttemptId, 'reconciliation_required', 'culqi_http_5xx'\)/)
  assert.match(source, /markMixedCulqiAttempt\(mixedAttemptId, 'reconciliation_required', 'culqi_ambiguous'\)/)
})

test('expired-order webhook checks unresolved attempts before any reservation release', () => {
  const source = readFileSync(new URL('../netlify/functions/culqi-webhook.ts', import.meta.url), 'utf8')
  const expired = source.indexOf("state === 'expired'")
  const unresolved = source.indexOf('if (unresolved)', expired)
  const release = source.indexOf('await releaseGiftReservation(', expired)
  assert.ok(expired > 0 && unresolved > expired && release > unresolved)
})

for (const attemptStatus of ['processing', 'reconciliation_required']) {
  test(`90-minute cleanup retains reservation with ${attemptStatus} charge attempt`, async () => {
    const originalFetch = globalThis.fetch
    const originalUrl = process.env.SUPABASE_URL
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_URL = 'https://staging.example.invalid'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder'
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      const path = String(url)
      calls.push({ path, body: options.body })
      if (path.includes('gift_card_order_payments?') && options.method === 'PATCH') return Response.json([{ order_id: orderId }])
      if (path.includes('gift_card_order_payments?')) return Response.json([{
        order_id: orderId, checkout_id: checkoutId, gift_card_id: cardId,
        gift_amount: 20, other_amount: 10, status: 'reserved', payment_state: 'payment_pending',
        expires_at: '2020-01-01T00:00:00.000Z',
      }])
      if (path.includes('orders?')) return Response.json([{
        id: orderId, order_number: 'TEST-ORDER', culqi_order_id: 'ord_test_synthetic',
        culqi_charge_id: null, payment_status: 'pending',
      }])
      if (path.includes('gift_card_culqi_attempts?')) return Response.json([{ id: 'attempt-id', status: attemptStatus }])
      assert.fail(`unexpected request: ${path}`)
    }
    try {
      await reconcileExpiredGiftReservations(cardId)
      assert.equal(calls.length, 4)
      assert.ok(calls.some((call) => call.path.includes('gift_card_culqi_attempts?')))
      assert.ok(calls.some((call) => call.path.includes('gift_card_order_payments?') && call.body?.includes('reconciliation_required')))
      assert.ok(!calls.some((call) => call.path.includes('/rpc/release_gift_card_order_reservation')))
      assert.ok(!calls.some((call) => call.path.includes('api.culqi.com')))
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) delete process.env.SUPABASE_URL
      else process.env.SUPABASE_URL = originalUrl
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    }
  })
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import * as verification from '../netlify/lib/culqi-verification.ts'
import { assertCulqiChargeOwnership } from '../netlify/lib/gift-cards.ts'
import { ensureCulqiEnvironment } from '../src/lib/culqiEnvironment.ts'

// Actual handlers, dependency injection only. No real HTTP or live credentials.
const load = async (name, dependencies) => {
  globalThis.__culqiReadiness = dependencies
  const source = (await readFile(new URL(`../netlify/functions/${name}.ts`, import.meta.url), 'utf8'))
    .replace(/import \{ ([^\n]+) \} from '[^']+'/g, (_, names) => `const { ${names} } = globalThis.__culqiReadiness`)
  return (await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}#${name}`)).default
}
const json = (status, body) => Response.json(body, { status })
const orderId = '11111111-1111-4111-8111-111111111111'
const attemptId = '22222222-2222-4222-8222-222222222222'
const checkoutId = '33333333-3333-4333-8333-333333333333'

test('runtime manual reconciliation, webhook, ownership and frontend isolation', async (t) => {
  const env = { ...process.env }, originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
    for (const key of ['CULQI_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]
    }
    delete globalThis.__culqiReadiness
  })
  process.env.SUPABASE_URL = 'https://staging.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'
  let environment = 'test', paid = false, completed = 0, released = 0, marked = 0, audited
  let charge = {}, role = 'admin'
  const payment = { order_id: orderId, checkout_id: checkoutId, gift_amount: 20, other_amount: 10, status: 'reserved' }
  const attempt = () => ({ id: attemptId, order_id: orderId, checkout_id: checkoutId, culqi_amount: 10, culqi_order_id: `ord_${environment}_fixture`, status: 'processing' })
  const dependencies = {
    ...verification, json,
    getMixedCulqiAttempts: async () => [attempt()], getOrderGiftPayment: async () => payment,
    getOrder: async () => ({ orderId: 'ORDER', databaseOrderId: orderId, paymentStatus: paid ? 'paid' : 'pending', total: 30 }),
    saveOrder: async (value) => { paid = value.paymentStatus === 'paid' },
    completeMixedCulqiAttempt: async (...args) => { completed++; audited = args; return { idempotent: completed > 1 } },
    clearMixedCulqiAttempt: async () => { released++ }, markMixedCulqiAttempt: async () => { marked++ },
    notifyOrder: async () => {}, confirmPromotionUse: async () => {}, releasePromotion: async () => {},
    getGiftPurchaseByCulqiOrder: async () => null, getOrderIdByCulqiOrder: async () => 'ORDER',
    applyGiftToOrder: async () => { completed++ }, getLinkedMixedCulqiCharge: async () => null,
    releaseGiftReservation: async () => { released++ }, markMixedCulqiExpired: async () => {}, setGiftPaymentState: async () => { marked++ },
    finalizeGiftPurchase: async () => assert.fail('Unexpected purchase activation'),
  }
  const reconcile = await load('gift-card-reconcile', dependencies)
  const webhook = await load('culqi-webhook', dependencies)
  const config = await load('culqi-config', dependencies)
  const manualRequest = (chargeId) => new Request('https://staging.invalid/reconcile', { method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ orderId, attemptId, decision: 'paid', chargeId, note: 'Synthetic audited reconciliation' }) })
  const eventRequest = (id) => new Request('https://staging.invalid/webhook', { method: 'POST', body: JSON.stringify({ type: 'order.status.changed', data: { id } }) })
  for (const mode of ['test', 'live']) {
    await t.test(`manual ${mode}, ambiguous GET, wrong-mode event and duplicate webhook`, async () => {
      environment = mode; process.env.CULQI_SECRET_KEY = `sk_${mode}_SYNTHETIC`
      paid = false; completed = released = marked = 0; role = 'admin'
      charge = { id: `chr_${mode}_fixture`, amount: 1000, currency_code: 'PEN', description: 'Pedido ORDER', metadata: { checkout_id: checkoutId } }
      globalThis.fetch = async (url) => {
        if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'actor' })
        if (String(url).includes('staff_profiles?')) return Response.json([{ role, active: true }])
        if (String(url).includes('/rest/v1/orders?')) return Response.json([{ order_number: 'ORDER', culqi_order_id: `ord_${mode}_fixture`, culqi_charge_id: null, payment_status: 'pending' }])
        if (String(url).includes('/v2/charges/')) return Response.json(charge)
        if (String(url).includes('/v2/orders/')) return Response.json({ id: `ord_${mode}_fixture`, order_number: 'ORDER', amount: 1000, currency_code: 'PEN', state: 'paid' })
        assert.fail('Unexpected network request')
      }
      assert.equal((await reconcile(manualRequest(charge.id))).status, 409)
      assert.equal(marked, 1); assert.equal(completed, 0); assert.equal(released, 0)
      charge.response_code = 'venta_exitosa'
      assert.equal((await reconcile(manualRequest(charge.id))).status, 200)
      assert.equal(audited[5], 'actor'); assert.equal(audited[6], 'Synthetic audited reconciliation')
      role = 'staff'
      assert.equal((await reconcile(manualRequest(charge.id))).status, 403)
      role = 'manager'
      assert.equal((await reconcile(manualRequest(`chr_${mode === 'test' ? 'live' : 'test'}_fixture`))).status, 400)
      paid = false; completed = 0
      assert.equal((await webhook(eventRequest(`ord_${mode === 'test' ? 'live' : 'test'}_fixture`))).status, 400)
      assert.equal(completed, 0)
      assert.equal((await webhook(eventRequest(`ord_${mode}_fixture`))).status, 200)
      assert.equal((await webhook(eventRequest(`ord_${mode}_fixture`))).status, 200)
      assert.equal(completed, 1); assert.equal(released, 0)
      const result = await config(new Request('https://staging.invalid/config'))
      assert.deepEqual(await result.json(), { environment: mode })
      globalThis.fetch = async () => Response.json({ environment: mode })
      await ensureCulqiEnvironment(`pk_${mode}_SYNTHETIC`)
      await assert.rejects(ensureCulqiEnvironment(`pk_${mode === 'test' ? 'live' : 'test'}_SYNTHETIC`), /no coincide/)
    })
  }
  await t.test('unknown backend fails closed before any request', async () => {
    process.env.CULQI_SECRET_KEY = 'unknown'
    globalThis.fetch = async () => assert.fail('Unexpected network request')
    assert.equal((await reconcile(manualRequest('chr_test_fixture'))).status, 503)
    assert.equal((await webhook(eventRequest('ord_test_fixture'))).status, 503)
    assert.equal((await config(new Request('https://staging.invalid/config'))).status, 503)
  })
  await t.test('existing charge ownership permits same checkout, rejects other checkout', async () => {
    process.env.CULQI_SECRET_KEY = 'sk_test_SYNTHETIC'
    globalThis.fetch = async () => Response.json([{ checkout_id: checkoutId }])
    await assertCulqiChargeOwnership('chr_test_fixture', checkoutId)
    await assert.rejects(assertCulqiChargeOwnership('chr_test_fixture', 'other'), /another checkout/)
  })
})

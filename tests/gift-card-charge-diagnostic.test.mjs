import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGiftChargeDiagnostic, checkoutIdFromDiagnosticCharge, diagnosticChargeId } from '../netlify/lib/gift-card-charge-diagnostic.ts'
import diagnosticFunction from '../netlify/functions/gift-card-charge-diagnostic.ts'

const checkoutId = 'fd69d4a7-9ad4-4ce8-968e-f00a0cae02ee'
const approvedChargeId = 'chr_test_KZ1Gsu01muNpi1Ns'
const stagingSupabaseOrigin = `https://${['kqfphrukxdvlrbjipjnx', 'supabase', 'co'].join('.')}`
const purchase = { checkout_id: checkoutId, amount: 50 }
const charge = {
  id: diagnosticChargeId, amount: 5000, currency: 'PEN', response_code: 'venta_exitosa', state: 'Exitosa',
  description: `Gift Card ${checkoutId}`, reference_code: 'abc123',
  metadata: { checkout_id: checkoutId, email: 'private@example.com', card_number: '4111111111111111', token: 'tkn_test_private' },
  email: 'private@example.com', phone: '933622680', source: { card_number: '4111111111111111' },
}

test('el diagnóstico compara exactamente los campos de confirmedCulqiCharge', () => {
  assert.equal(diagnosticChargeId, approvedChargeId)
  assert.equal(checkoutIdFromDiagnosticCharge(charge), checkoutId)
  assert.deepEqual(buildGiftChargeDiagnostic(charge, purchase).checks, {
    id: true, amount: true, currency: true, response_code: true, description: true,
  })
  assert.equal(buildGiftChargeDiagnostic({ ...charge, amount: 4999 }, purchase).checks.amount, false)
  assert.equal(buildGiftChargeDiagnostic({ ...charge, response_code: 'denegada' }, purchase).checks.response_code, false)
  assert.equal(buildGiftChargeDiagnostic({ ...charge, description: 'Otra compra' }, purchase).checks.description, false)
})

test('la respuesta solo contiene los campos permitidos y no filtra datos sensibles', () => {
  const result = buildGiftChargeDiagnostic(charge, purchase)
  assert.deepEqual(Object.keys(result), [
    'id', 'amount', 'currency', 'currency_code', 'response_code', 'state', 'description',
    'order_id', 'order_number', 'reference_code', 'metadata', 'checks',
  ])
  assert.deepEqual(result.metadata, { checkout_id: checkoutId, order_id: null, order_number: null })
  const output = JSON.stringify(result)
  assert.doesNotMatch(output, /private@example\.com|933622680|4111111111111111|tkn_test_private|card_number|phone|email/)
})

test('metadata desconocida y descripción libre quedan redactadas', () => {
  const result = buildGiftChargeDiagnostic({ ...charge, description: 'Cliente privado private@example.com', metadata: { name: 'Nombre Privado', note: '933622680' } }, null)
  assert.equal(result.description, null)
  assert.deepEqual(result.metadata, { checkout_id: null, order_id: null, order_number: null })
  assert.ok(Object.values(result.checks).some((check) => !check))
  assert.doesNotMatch(JSON.stringify(result), /private@example\.com|933622680|Nombre Privado/)
})

test('la Function solo hace GET al cargo TEST fijo y devuelve una respuesta sanitizada', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = Object.fromEntries(['SITE_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CULQI_SECRET_KEY']
    .map((name) => [name, process.env[name]]))
  const requests = []
  try {
    process.env.SITE_ID = '9c0fe271-da6d-4ff2-a7ab-3f0743ccecae'
    process.env.SUPABASE_URL = stagingSupabaseOrigin
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'staging-test-placeholder'
    process.env.CULQI_SECRET_KEY = 'sk_test_placeholder'
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), method: options?.method })
      if (String(url).startsWith('https://api.culqi.com/v2/charges/')) return Response.json(charge)
      return Response.json([purchase])
    }
    const result = await diagnosticFunction(new Request('https://the-black-cat-giftcards-staging.netlify.app/.netlify/functions/gift-card-charge-diagnostic'))
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
      [`https://api.culqi.com/v2/charges/${diagnosticChargeId}`, 'GET'],
      [`${stagingSupabaseOrigin}/rest/v1/gift_card_purchases?checkout_id=eq.${checkoutId}&select=*`, undefined],
    ])
    const body = await result.text()
    assert.deepEqual(JSON.parse(body).checks, { id: true, amount: true, currency: true, response_code: true, description: true })
    assert.doesNotMatch(body, /private@example\.com|933622680|4111111111111111|tkn_test_private|sk_test_placeholder|staging-test-placeholder/)

    process.env.SITE_ID = 'production-site-id'
    assert.equal((await diagnosticFunction(new Request('https://example.invalid'))).status, 404)
    assert.equal(requests.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

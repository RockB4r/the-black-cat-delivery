import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { culqiGiftCardOrderNumber, confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder, sanitizeCulqiErrorBody, getCulqiEnvironment, validateCulqiChargeId, validateCulqiOrderId, evaluateOriginalChargeResponse, evaluateReconciledChargeResponse } from '../netlify/lib/culqi-verification.ts'

const previousSecret = process.env.CULQI_SECRET_KEY
process.env.CULQI_SECRET_KEY = 'sk_test_SYNTHETIC'
after(() => { if (previousSecret === undefined) delete process.env.CULQI_SECRET_KEY; else process.env.CULQI_SECRET_KEY = previousSecret })

const expected = { id: 'ord_test_test', orderNumber: 'TBC-TEST-001', amountInCents: 3000 }
const order = { id: expected.id, order_number: expected.orderNumber, amount: 3000, currency_code: 'PEN', state: 'paid' }

test('UUID estándar genera un número Culqi determinista de máximo 36 caracteres', () => {
  const checkoutId = '4656e4ad-ef27-4d70-84f2-02b6a2efb847'
  const number = culqiGiftCardOrderNumber(checkoutId)
  assert.equal(number, 'GC-4656e4adef274d7084f202b6a2efb847')
  assert.equal(number.length, 35)
  assert.equal(culqiGiftCardOrderNumber(checkoutId), number)
  assert.notEqual(culqiGiftCardOrderNumber('2f93f26c-916f-4fb4-976e-dc434676e4d5'), number)
})

test('la verificación e idempotencia aceptan el mismo número generado', () => {
  const checkoutId = '4656e4ad-ef27-4d70-84f2-02b6a2efb847'
  const orderNumber = culqiGiftCardOrderNumber(checkoutId)
  const giftExpected = { id: 'ord_test_123', orderNumber, amountInCents: 5000 }
  const giftOrder = { id: giftExpected.id, order_number: orderNumber, amount: 5000, currency_code: 'PEN', state: 'pending' }
  assert.equal(matchingCulqiOrder(giftOrder, giftExpected), true)
  assert.equal(matchingCulqiOrder(giftOrder, { ...giftExpected, orderNumber: culqiGiftCardOrderNumber(checkoutId) }), true)
  assert.equal(matchingCulqiOrder({ ...giftOrder, order_number: `GC-${checkoutId}` }, giftExpected), false)
})

test('el error de Culqi se trunca y redacta datos sensibles', () => {
  const body = JSON.stringify({ merchant_message: 'order_number inválido', email: 'cliente@example.com', phone_number: '933622680', authorization: 'Bearer sk_test_FAKESECRET123', extra: 'x'.repeat(800) })
  const sanitized = sanitizeCulqiErrorBody(body)
  assert.match(sanitized, /order_number inválido/)
  assert.ok(sanitized.length <= 600)
  assert.doesNotMatch(sanitized, /cliente@example\.com|933622680|FAKESECRET123/)
})

test('un pedido Culqi solo confirma el checkout esperado, en PEN y por monto exacto', () => {
  assert.equal(confirmedCulqiOrder(order, expected), true)
  assert.equal(confirmedCulqiOrder({ ...order, id: 'ord_otro' }, expected), false)
  assert.equal(confirmedCulqiOrder({ ...order, order_number: 'OTRO' }, expected), false)
  assert.equal(confirmedCulqiOrder({ ...order, amount: 2999 }, expected), false)
  assert.equal(confirmedCulqiOrder({ ...order, currency_code: 'USD' }, expected), false)
  assert.equal(confirmedCulqiOrder({ ...order, state: 'pending' }, expected), false)
})

test('un pedido vencido no se confunde con uno pagado', () => {
  assert.equal(expiredCulqiOrder({ ...order, state: 'expired' }, expected), true)
  assert.equal(expiredCulqiOrder(order, expected), false)
  assert.equal(matchingCulqiOrder({ ...order, state: 'pending' }, expected), true)
})

test('cargo aprobado exige referencia, PEN, monto y descripción esperados', () => {
  const charge = { id: 'chr_test_test', response_code: 'venta_exitosa', amount: 3000, currency: 'PEN', description: 'Pedido TBC-TEST-001' }
  const chargeExpected = { id: charge.id, amountInCents: 3000, description: charge.description }
  assert.equal(confirmedCulqiCharge(charge, chargeExpected), true)
  assert.equal(confirmedCulqiCharge({ ...charge, id: 'chr_otro' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, amount: 2999 }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, currency: 'USD' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, response_code: 'denegada' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, description: 'Pedido ajeno' }, chargeExpected), false)
})


for (const environment of ['test', 'live']) {
  test(`backend ${environment}: IDs, POST original y GET posterior no se confunden`, () => {
    process.env.CULQI_SECRET_KEY = `sk_${environment}_SYNTHETIC`
    try {
      const opposite = environment === 'test' ? 'live' : 'test'
      assert.equal(getCulqiEnvironment(), environment)
      assert.equal(validateCulqiChargeId(`chr_${environment}_fixture`), true)
      assert.equal(validateCulqiOrderId(`ord_${environment}_fixture`), true)
      assert.equal(validateCulqiChargeId(`chr_${opposite}_fixture`), false)
      assert.equal(validateCulqiOrderId(`ord_${opposite}_fixture`), false)
      const expectedCharge = { id: `chr_${environment}_fixture`, amountInCents: 5000, description: 'Gift Card checkout', checkoutId: 'checkout' }
      const charge = { id: expectedCharge.id, amount: 5000, currency_code: 'PEN', description: expectedCharge.description, response_code: null, state: null }
      assert.equal(evaluateOriginalChargeResponse(charge, expectedCharge, 201), 'approved')
      assert.equal(evaluateOriginalChargeResponse(charge, expectedCharge, 200), 'ambiguous')
      assert.equal(evaluateReconciledChargeResponse(charge, expectedCharge, 200), 'ambiguous')
      assert.equal(confirmedCulqiCharge(charge, expectedCharge), false)
      for (const evaluator of [evaluateOriginalChargeResponse, evaluateReconciledChargeResponse]) {
        assert.equal(evaluator({ ...charge, response_code: 'venta_exitosa' }, expectedCharge, 201), 'approved')
        assert.equal(evaluator({ ...charge, state: 'Exitosa' }, expectedCharge, 200), 'approved')
        assert.equal(evaluator({ ...charge, response_code: 'denegada' }, expectedCharge, 201), 'failed')
        assert.equal(evaluator({ ...charge, state: 'Rechazada', response_code: 'venta_exitosa' }, expectedCharge, 201), 'failed')
        for (const bad of [{ amount: 4999 }, { currency_code: 'USD' }, { currency: 'USD' }, { description: 'Otra compra' }, { id: `chr_${opposite}_fixture` }, { metadata: { checkout_id: 'other' } }]) {
          assert.equal(evaluator({ ...charge, ...bad }, expectedCharge, 201), 'invalid')
        }
        assert.equal(evaluator({ ...charge, metadata: { checkout_id: 'checkout' } }, expectedCharge, 201), evaluator(charge, expectedCharge, 201))
        for (const status of [400, 402, 500]) assert.equal(evaluator(charge, expectedCharge, status), 'invalid')
      }
    } finally { process.env.CULQI_SECRET_KEY = 'sk_test_SYNTHETIC' }
  })
}
test('clave ausente/desconocida no autoriza ningún entorno', () => {
  for (const key of [undefined, '', 'pk_test_fixture', 'sk_unknown_fixture', 'sk_live_', 'sk_test_fixture extra']) {
    assert.equal(getCulqiEnvironment(key ?? ''), null)
    assert.equal(validateCulqiChargeId('chr_test_fixture', getCulqiEnvironment(key ?? '')), false)
    assert.equal(validateCulqiOrderId('ord_live_fixture', getCulqiEnvironment(key ?? '')), false)
  }
})
test('un culqi_charge_id ya utilizado se rechaza al vincular otra compra', async () => {
  const { recordGiftCharge } = await import('../netlify/lib/gift-cards.ts')
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    process.env.SUPABASE_URL = 'https://staging.invalid'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder'
    globalThis.fetch = async () => Response.json({ code: '23505', message: 'duplicate key value violates unique constraint' }, { status: 409 })
    await assert.rejects(recordGiftCharge('249e9e14-c3b7-4761-a62b-4588d417db8d', 'chr_test_1234567890123456'), /HTTP 409/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  }
})

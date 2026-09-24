import test from 'node:test'
import assert from 'node:assert/strict'
import { culqiGiftCardOrderNumber, confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder, sanitizeCulqiErrorBody } from '../netlify/lib/culqi-verification.ts'

const expected = { id: 'ord_live_test', orderNumber: 'TBC-TEST-001', amountInCents: 3000 }
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
  const charge = { id: 'chr_live_test', response_code: 'venta_exitosa', amount: 3000, currency: 'PEN', description: 'Pedido TBC-TEST-001' }
  const chargeExpected = { id: charge.id, amountInCents: 3000, description: charge.description }
  assert.equal(confirmedCulqiCharge(charge, chargeExpected), true)
  assert.equal(confirmedCulqiCharge({ ...charge, id: 'chr_otro' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, amount: 2999 }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, currency: 'USD' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, response_code: 'denegada' }, chargeExpected), false)
  assert.equal(confirmedCulqiCharge({ ...charge, description: 'Pedido ajeno' }, chargeExpected), false)
})

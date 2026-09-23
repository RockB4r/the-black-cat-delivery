import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder } from '../netlify/lib/culqi-verification.ts'

const expected = { id: 'ord_live_test', orderNumber: 'TBC-TEST-001', amountInCents: 3000 }
const order = { id: expected.id, order_number: expected.orderNumber, amount: 3000, currency_code: 'PEN', state: 'paid' }

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

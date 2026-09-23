import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutForGiftPurchase, emptyGiftPurchaseForm, newGiftCheckout, restoreGiftCheckout } from '../src/giftCardCheckout.ts'

const firstId = '4656e4ad-ef27-4d70-84f2-02b6a2efb847'
const secondId = '2f93f26c-916f-4fb4-976e-dc434676e4d5'
const form = () => ({ ...emptyGiftPurchaseForm(), purchaserName: 'Cliente Prueba', purchaserEmail: 'cliente@example.com', recipientName: 'Beneficiaria' })
const submitted = () => checkoutForGiftPurchase(newGiftCheckout(() => firstId), form())

test('un reintento idéntico conserva el checkout_id', () => {
  const original = submitted()
  const retry = checkoutForGiftPurchase(original, { ...original.form }, () => secondId)
  assert.equal(retry.checkoutId, firstId)
})

test('al refrescar se restauran los datos y el checkout_id', () => {
  const original = submitted()
  const restored = restoreGiftCheckout(JSON.stringify(original), () => secondId)
  assert.equal(restored.checkoutId, firstId)
  assert.deepEqual(restored.form, original.form)
  assert.equal(checkoutForGiftPurchase(restored, restored.form, () => secondId).checkoutId, firstId)
})

test('un checkout_id legacy sin formulario no se reutiliza', () => {
  assert.equal(restoreGiftCheckout(firstId, () => secondId).checkoutId, secondId)
})

for (const [label, change] of [
  ['monto', { amountChoice: '75' }],
  ['entrega', { deliveryMethod: 'email', recipientEmail: 'beneficiaria@example.com' }],
  ['beneficiario', { recipientName: 'Otra persona' }],
  ['email', { purchaserEmail: 'otro@example.com' }],
  ['teléfono', { purchaserPhone: '999888777' }],
  ['comprador', { purchaserName: 'Otra persona' }],
  ['transferibilidad', { transferable: false }],
  ['mensaje', { message: 'Feliz cumpleaños' }],
]) test(`cambiar ${label} genera un checkout_id nuevo`, () => {
  const original = submitted()
  const next = checkoutForGiftPurchase(original, { ...original.form, ...change }, () => secondId)
  assert.equal(next.checkoutId, secondId)
})

test('iniciar otra compra crea un checkout_id nuevo y limpia el formulario', () => {
  const original = submitted()
  const next = newGiftCheckout(() => secondId)
  assert.notEqual(next.checkoutId, original.checkoutId)
  assert.deepEqual(next.form, emptyGiftPurchaseForm())
  assert.equal(next.submitted, false)
})

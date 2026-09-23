import test from 'node:test'
import assert from 'node:assert/strict'
import { giftCardDeliveryDraft, parseGiftPurchase } from '../netlify/lib/gift-cards.ts'

const base = { checkoutId: '4656e4ad-ef27-4d70-84f2-02b6a2efb847', amountChoice: '50', purchaserName: 'Cliente Prueba', purchaserEmail: 'cliente@example.com', transferable: true, deliveryMethod: 'personal' }

for (const amount of [50, 75, 100, 200]) test(`permite monto fijo S/${amount}`, () => {
  assert.equal(parseGiftPurchase({ ...base, amountChoice: String(amount) })?.amount, amount)
})

test('rechaza monto libre hasta S/100 y permite uno mayor', () => {
  for (const amount of ['0', '50', '99.99', '100']) assert.equal(parseGiftPurchase({ ...base, amountChoice: 'custom', customAmount: amount }), null)
  assert.equal(parseGiftPurchase({ ...base, amountChoice: 'custom', customAmount: '100.01' })?.amount, 100.01)
})

test('rechaza montos fijos manipulados y dinero con más de dos decimales', () => {
  assert.equal(parseGiftPurchase({ ...base, amountChoice: '20' }), null)
  assert.equal(parseGiftPurchase({ ...base, amountChoice: 'custom', customAmount: '150.001' }), null)
})

test('no transferible exige beneficiario', () => {
  assert.equal(parseGiftPurchase({ ...base, transferable: false }), null)
  assert.ok(parseGiftPurchase({ ...base, transferable: false, recipientName: 'Beneficiaria' }))
})

test('email y WhatsApp exigen destinatario correspondiente', () => {
  assert.equal(parseGiftPurchase({ ...base, deliveryMethod: 'email' }), null)
  assert.equal(parseGiftPurchase({ ...base, deliveryMethod: 'whatsapp' }), null)
  assert.ok(parseGiftPurchase({ ...base, deliveryMethod: 'email', recipientEmail: 'socio@example.com' }))
  assert.ok(parseGiftPurchase({ ...base, deliveryMethod: 'whatsapp', recipientPhone: '+51 933 622 680' }))
})

test('el borrador de entrega contiene solo el enlace seguro y la nota tributaria', () => {
  const draft = giftCardDeliveryDraft({ recipient_name: 'Casey', purchaser_name: 'Kike', recipient_email: 'casey@example.com', recipient_phone: null, delivery_method: 'email', gift_message: 'Feliz día' }, { token: 'a'.repeat(64), code: 'BC-GC-000001', amount: 75, expires_at: '2026-11-06T00:00:00Z' }, 'https://theblackcatrockbar.com')
  assert.match(draft.link, /^https:\/\/theblackcatrockbar\.com\/gift\/[a-f0-9]{64}$/)
  assert.match(draft.content, /comprobante de pago se emitirá cuando/)
  assert.doesNotMatch(draft.content, /casey@example\.com/)
})

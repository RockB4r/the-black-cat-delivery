import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeGiftPaymentCode } from '../src/lib/giftPaymentCode.ts'

const code = '0123456789abcdef0123456789abcdef'

test('el código de pago de 32 hex es válido sin separadores', () => {
  assert.equal(normalizeGiftPaymentCode(code), code)
})

test('guiones y espacios se eliminan antes de validar', () => {
  assert.equal(normalizeGiftPaymentCode(' 01234567-89ABCDEF-01234567-89ABCDEF '), code)
  assert.equal(normalizeGiftPaymentCode(' 01234567 89ABCDEF\t01234567\n89ABCDEF '), code)
})

for (const invalid of [
  '0123456789abcdef',
  '0123456789abcdef0123456789abcdeg',
  '0123456789abcdef0123456789abcde!',
  'BC-GC-000028',
  `${code}/`,
]) test(`rechaza código inválido: ${invalid.includes('BC-GC') ? 'código amigable' : 'formato inválido'}`, () => {
  assert.equal(normalizeGiftPaymentCode(invalid), null)
})

test('consulta, pedido total y pedido mixto usan el mismo código normalizado', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const quote = readFileSync(new URL('../netlify/functions/gift-card-quote.ts', import.meta.url), 'utf8')
  const order = readFileSync(new URL('../netlify/functions/create-culqi-order.ts', import.meta.url), 'utf8')
  assert.match(app, /paymentCode: normalizedGiftPaymentCode/)
  assert.match(app, /giftPaymentCode: normalizedGiftPaymentCode/)
  assert.match(quote, /normalizeGiftPaymentCode\(body\.paymentCode\)/)
  assert.match(order, /normalizeGiftPaymentCode\(rawGiftPaymentCode\)/)
  assert.match(order, /giftPayment\.other_amount === 0/)
  assert.match(order, /giftPayment\?\.other_amount \?\? order\.total/)
})

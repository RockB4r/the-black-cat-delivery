import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = readFileSync(new URL('../src/GiftCardPage.tsx', import.meta.url), 'utf8')
const checkout = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('la Gift Card digital distingue el código público, el QR y el secreto de pago', () => {
  assert.match(page, /Código de Gift Card[\s\S]*\{card\.code\}/)
  assert.match(page, /QR \/ enlace digital[\s\S]*El QR sirve para abrir y ver esta Gift Card/)
  assert.match(page, /Código secreto para pagar online[\s\S]*\{card\.paymentCode\}/)
  assert.match(page, /Copiar código de pago/)
  assert.match(page, /navigator\.clipboard\.writeText\(card\.paymentCode\)/)
  assert.doesNotMatch(page, /checkout_id|checkoutId/)
})

test('el checkout indica dónde encontrar el secreto y aclara el error 404', () => {
  assert.match(checkout, /Código secreto de Gift Card/)
  assert.match(checkout, /Copia el código de pago que aparece en tu Gift Card digital/)
  assert.match(checkout, /response\.status === 404[\s\S]*Código de pago no válido/)
})

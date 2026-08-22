import type { OrderInput, PaymentMethod } from './orders'
import { trustedItems } from './orders'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export const parseOrderInput = (body: unknown, paymentMethod: PaymentMethod): OrderInput | null => {
  if (typeof body !== 'object' || body === null) return null
  const data = body as Record<string, unknown>
  const items = trustedItems(data.items)
  const customer = typeof data.customer === 'string' ? data.customer.trim() : ''
  const phone = typeof data.phone === 'string' ? data.phone.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim() : ''
  const address = typeof data.address === 'string' ? data.address.trim() : ''
  const fulfillment = data.fulfillment === 'pickup' ? 'pickup' : data.fulfillment === 'delivery' ? 'delivery' : null
  if (!items || !customer || !phone || !emailPattern.test(email) || !fulfillment || (fulfillment === 'delivery' && !address)) return null
  return { customer, phone, email, address, fulfillment, items: items.items, paymentMethod }
}

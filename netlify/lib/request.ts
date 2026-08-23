import type { OrderInput, PaymentMethod, ReceiptType } from './orders'
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
  const receiptType: ReceiptType | null = data.receiptType === 'boleta' || data.receiptType === 'factura' ? data.receiptType : null
  const dni = typeof data.dni === 'string' ? data.dni.trim() : ''
  const ruc = typeof data.ruc === 'string' ? data.ruc.trim() : ''
  if (!items || !customer || !phone || !emailPattern.test(email) || !fulfillment || !receiptType || (fulfillment === 'delivery' && !address)) return null
  if (receiptType === 'boleta' && dni && !/^\d{8}$/.test(dni)) return null
  if (receiptType === 'factura' && !/^\d{11}$/.test(ruc)) return null
  return { customer, phone, email, address, fulfillment, receiptType, ...(receiptType === 'boleta' && dni ? { dni } : {}), ...(receiptType === 'factura' ? { ruc } : {}), items: items.items, paymentMethod }
}

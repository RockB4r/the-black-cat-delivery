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
  const checkoutId = typeof data.checkoutId === 'string' ? data.checkoutId.trim() : ''
  if (!items || !customer || !phone || !emailPattern.test(email) || !fulfillment || !receiptType || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId) || (fulfillment === 'delivery' && !address)) return null
  if (receiptType === 'boleta' && dni && !/^\d{8}$/.test(dni)) return null
  if (receiptType === 'factura' && !/^\d{11}$/.test(ruc)) return null
  return { customer, phone, email, address, fulfillment, receiptType, checkoutId, ...(receiptType === 'boleta' && dni ? { dni } : {}), ...(receiptType === 'factura' ? { ruc } : {}), items: items.items, paymentMethod }
}

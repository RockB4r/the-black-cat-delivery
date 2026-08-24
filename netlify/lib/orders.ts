import { getStore } from '@netlify/blobs'
import menuData from '../../src/data/menu.json'
import type { MenuCategory } from '../../src/data/types'

export type PaymentMethod = 'cash' | 'card' | 'wallet'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired'
export type NotificationStatus = 'pending' | 'sent' | 'failed'
export type ReceiptType = 'boleta' | 'factura'

export type OrderItem = { name: string; price: number; quantity: number; note?: string; style?: string }
export type StoreOrder = {
  orderId: string
  createdAt: string
  customer: string
  phone: string
  email: string
  address: string
  fulfillment: 'delivery' | 'pickup'
  receiptType: ReceiptType
  dni?: string
  ruc?: string
  items: OrderItem[]
  notes: string[]
  total: number
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  culqiChargeId?: string
  culqiOrderId?: string
  emailNotificationStatus: NotificationStatus
  whatsappNotificationStatus: NotificationStatus
}

export type OrderInput = Omit<StoreOrder, 'orderId' | 'createdAt' | 'total' | 'paymentStatus' | 'culqiChargeId' | 'culqiOrderId' | 'emailNotificationStatus' | 'whatsappNotificationStatus' | 'notes'>

const orders = () => getStore({ name: 'the-black-cat-orders', consistency: 'strong' })
const catalog = new Map((menuData as MenuCategory[]).flatMap((category) => category.items.map((item) => [item.name, item] as const)))

export const buildOrderId = () => `TBC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

export const trustedItems = (items: unknown): { items: OrderItem[]; total: number } | null => {
  if (!Array.isArray(items) || items.length === 0) return null
  const validated: OrderItem[] = []
  let total = 0
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null
    const { name, quantity, note, style } = item as Record<string, unknown>
    const product = typeof name === 'string' ? catalog.get(name) : undefined
    if (!product || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || (note !== undefined && typeof note !== 'string') || (style !== undefined && typeof style !== 'string')) return null
    const selectedStyle = typeof style === 'string' ? product.styles?.find((candidate) => candidate.name === style) : undefined
    if ((product.styles && !selectedStyle) || (!product.styles && style !== undefined)) return null
    const price = selectedStyle?.price ?? product.price
    validated.push({ name, price, quantity, style: selectedStyle?.name, note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 150) : undefined })
    total += price * quantity
  }
  return Number.isSafeInteger(total * 100) && total > 0 ? { items: validated, total } : null
}

export const createOrder = async (input: OrderInput, paymentStatus: PaymentStatus): Promise<StoreOrder> => {
  const order: StoreOrder = {
    ...input,
    orderId: buildOrderId(),
    createdAt: new Date().toISOString(),
    notes: input.items.flatMap((item) => item.note ? [`${item.name}${item.style ? ` · ${item.style}` : ''}: ${item.note}`] : []),
    total: input.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    paymentStatus,
    emailNotificationStatus: 'pending',
    whatsappNotificationStatus: 'pending',
  }
  await orders().setJSON(order.orderId, order, { onlyIfNew: true })
  return order
}

export const getOrder = async (orderId: string) => orders().getJSON<StoreOrder>(orderId, { consistency: 'strong' })
export const saveOrder = async (order: StoreOrder) => orders().setJSON(order.orderId, order)

export const linkCulqiOrder = async (culqiOrderId: string, orderId: string) => {
  await getStore({ name: 'the-black-cat-culqi-order-links', consistency: 'strong' }).set(culqiOrderId, orderId, { onlyIfNew: true })
}

export const getOrderIdByCulqiOrder = async (culqiOrderId: string) => getStore({ name: 'the-black-cat-culqi-order-links', consistency: 'strong' }).get(culqiOrderId, { consistency: 'strong' })

import { getStore } from '@netlify/blobs'
import menuData from '../../src/data/menu.json'

export type PaymentMethod = 'cash' | 'card' | 'wallet'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired'
export type NotificationStatus = 'pending' | 'sent' | 'failed'

export type OrderItem = { name: string; price: number; quantity: number; note?: string }
export type StoreOrder = {
  orderId: string
  createdAt: string
  customer: string
  phone: string
  email: string
  address: string
  fulfillment: 'delivery' | 'pickup'
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
const prices = new Map(menuData.flatMap((category) => category.items.map((item) => [item.name, item.price] as const)))

export const buildOrderId = () => `TBC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

export const trustedItems = (items: unknown): { items: OrderItem[]; total: number } | null => {
  if (!Array.isArray(items) || items.length === 0) return null
  const validated: OrderItem[] = []
  let total = 0
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null
    const { name, quantity, note } = item as Record<string, unknown>
    const price = typeof name === 'string' ? prices.get(name) : undefined
    if (price === undefined || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || (note !== undefined && typeof note !== 'string')) return null
    validated.push({ name, price, quantity, note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 150) : undefined })
    total += price * quantity
  }
  return Number.isSafeInteger(total * 100) && total > 0 ? { items: validated, total } : null
}

export const createOrder = async (input: OrderInput, paymentStatus: PaymentStatus): Promise<StoreOrder> => {
  const order: StoreOrder = {
    ...input,
    orderId: buildOrderId(),
    createdAt: new Date().toISOString(),
    notes: input.items.flatMap((item) => item.note ? [`${item.name}: ${item.note}`] : []),
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

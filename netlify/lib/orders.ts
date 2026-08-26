import { getStore } from '@netlify/blobs'
import menuData from '../../src/data/menu.json'
import type { MenuCategory } from '../../src/data/types'
import { syncKitchenPaymentStatus } from './kitchen'

export type PaymentMethod = 'cash' | 'card' | 'wallet'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired'
export type NotificationStatus = 'pending' | 'sent' | 'failed'
export type ReceiptType = 'boleta' | 'factura'

export type OrderItem = { name: string; price: number; quantity: number; note?: string; style?: string; sauce?: string }
export type StoreOrder = {
  orderId: string
  databaseOrderId?: string
  checkoutId: string
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

export type OrderInput = Omit<StoreOrder, 'orderId' | 'databaseOrderId' | 'createdAt' | 'total' | 'paymentStatus' | 'culqiChargeId' | 'culqiOrderId' | 'emailNotificationStatus' | 'whatsappNotificationStatus' | 'notes'>

const orders = () => getStore({ name: 'the-black-cat-orders', consistency: 'strong' })
const checkoutLinks = () => getStore({ name: 'the-black-cat-checkout-links', consistency: 'strong' })
const catalog = new Map((menuData as MenuCategory[]).flatMap((category) => category.items.map((item) => [item.name, item] as const)))

export const buildOrderId = () => `TBC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

export const trustedItems = (items: unknown): { items: OrderItem[]; total: number } | null => {
  if (!Array.isArray(items) || items.length === 0) return null
  const validated: OrderItem[] = []
  let total = 0
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null
    const { name, quantity, note, style, sauce } = item as Record<string, unknown>
    const product = typeof name === 'string' ? catalog.get(name) : undefined
    if (!product || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0 || (note !== undefined && typeof note !== 'string') || (style !== undefined && typeof style !== 'string') || (sauce !== undefined && typeof sauce !== 'string')) return null
    const selectedStyle = typeof style === 'string' ? product.styles?.find((candidate) => candidate.name === style) : undefined
    const selectedSauce = typeof sauce === 'string' ? product.sauces?.find((candidate) => candidate.name === sauce) : undefined
    if ((product.styles && !selectedStyle) || (!product.styles && style !== undefined) || (product.sauces && !selectedSauce) || (!product.sauces && sauce !== undefined)) return null
    const price = selectedStyle?.price ?? product.price
    validated.push({ name, price, quantity, style: selectedStyle?.name, sauce: selectedSauce?.name, note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 150) : undefined })
    total += price * quantity
  }
  return Number.isSafeInteger(total * 100) && total > 0 ? { items: validated, total } : null
}

type KitchenOrderInsertResult = { order_id: string; order_number: string; created: boolean }

const kitchenOrderPayload = (order: StoreOrder) => ({
  order_number: order.orderId,
  checkout_id: order.checkoutId,
  customer_name: order.customer,
  customer_email: order.email || '',
  customer_phone: order.phone,
  order_type: order.fulfillment === 'delivery' ? 'delivery' : 'pick_up',
  delivery_address: order.fulfillment === 'delivery' ? order.address : '',
  delivery_reference: '',
  payment_method: order.paymentMethod,
  payment_status: order.paymentStatus,
  subtotal: order.total,
  delivery_fee: 0,
  total: order.total,
  notes: order.notes.join('\n'),
  created_at: order.createdAt,
})

const kitchenItemsPayload = (order: StoreOrder) => order.items.map((item) => ({
  product_name: `${item.name}${item.style ? ` · ${item.style}` : ''}${item.sauce ? ` · Salsa ${item.sauce}` : ''}`,
  category: categoryByProduct.get(item.name) ?? 'Sin categoría',
  quantity: item.quantity,
  unit_price: item.price,
  notes: item.note ?? '',
}))

const categoryByProduct = new Map((menuData as MenuCategory[]).flatMap((category) => category.items.map((item) => [item.name, category.name] as const)))

const persistOrderAndItems = async (order: StoreOrder): Promise<KitchenOrderInsertResult> => {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase server environment is incomplete.')
  const response = await fetch(`${url}/rest/v1/rpc/create_kitchen_order_with_items`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_order: kitchenOrderPayload(order), p_items: kitchenItemsPayload(order) }),
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || !result[0] || typeof result[0] !== 'object') throw new Error(`Atomic kitchen order creation failed with HTTP ${response.status}`)
  const row = result[0] as Partial<KitchenOrderInsertResult>
  if (typeof row.order_id !== 'string' || typeof row.order_number !== 'string' || typeof row.created !== 'boolean') throw new Error('Atomic kitchen order creation returned an invalid response.')
  return row as KitchenOrderInsertResult
}

export const getOrderByCheckoutId = async (checkoutId: string) => {
  const orderId = await checkoutLinks().get(checkoutId, { consistency: 'strong' })
  return typeof orderId === 'string' ? getOrder(orderId) : null
}

export const createOrder = async (input: OrderInput, paymentStatus: PaymentStatus): Promise<StoreOrder> => {
  const existing = await getOrderByCheckoutId(input.checkoutId)
  if (existing) return existing

  const order: StoreOrder = {
    ...input,
    orderId: buildOrderId(),
    createdAt: new Date().toISOString(),
    notes: input.items.flatMap((item) => item.note ? [`${item.name}${item.style ? ` · ${item.style}` : ''}${item.sauce ? ` · Salsa ${item.sauce}` : ''}: ${item.note}`] : []),
    total: input.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    paymentStatus,
    emailNotificationStatus: 'pending',
    whatsappNotificationStatus: 'pending',
  }
  const saved = await persistOrderAndItems(order)
  if (!saved.created) {
    const concurrentOrder = await getOrder(saved.order_number)
    if (concurrentOrder) return concurrentOrder
    throw new Error('The checkout is already being processed. Retry this same operation in a moment.')
  }
  order.databaseOrderId = saved.order_id
  await orders().setJSON(order.orderId, order, { onlyIfNew: true })
  await checkoutLinks().set(input.checkoutId, order.orderId, { onlyIfNew: true })
  return order
}

export const getOrder = async (orderId: string) => orders().getJSON<StoreOrder>(orderId, { consistency: 'strong' })
export const saveOrder = async (order: StoreOrder) => { await orders().setJSON(order.orderId, order); await syncKitchenPaymentStatus(order) }

export const linkCulqiOrder = async (culqiOrderId: string, orderId: string) => {
  await getStore({ name: 'the-black-cat-culqi-order-links', consistency: 'strong' }).set(culqiOrderId, orderId, { onlyIfNew: true })
}

export const getOrderIdByCulqiOrder = async (culqiOrderId: string) => getStore({ name: 'the-black-cat-culqi-order-links', consistency: 'strong' }).get(culqiOrderId, { consistency: 'strong' })

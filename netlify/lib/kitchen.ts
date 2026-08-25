import menuData from '../../src/data/menu.json'
import type { MenuCategory } from '../../src/data/types'
import type { StoreOrder } from './orders'

const categoryByProduct = new Map((menuData as MenuCategory[]).flatMap((category) => category.items.map((item) => [item.name, category.name] as const)))

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

export const persistKitchenOrder = async (order: StoreOrder) => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error(`Kitchen order ${order.orderId} was not persisted: Supabase server environment is incomplete.`); return }
  try {
    const orderResponse = await fetch(`${url}/rest/v1/orders`, { method: 'POST', headers: headers(key, { Prefer: 'return=representation' }), body: JSON.stringify({ order_number: order.orderId, customer_name: order.customer, customer_email: order.email || null, customer_phone: order.phone, order_type: order.fulfillment === 'delivery' ? 'delivery' : 'pick_up', delivery_address: order.fulfillment === 'delivery' ? order.address : null, delivery_reference: null, payment_method: order.paymentMethod, payment_status: order.paymentStatus, status: 'nuevo', subtotal: order.total, delivery_fee: 0, total: order.total, notes: order.notes.length ? order.notes.join('\n') : null, created_at: order.createdAt }) })
    const saved: unknown = await orderResponse.json().catch(() => null)
    if (!orderResponse.ok || !Array.isArray(saved) || !saved[0] || typeof saved[0] !== 'object' || !('id' in saved[0]) || typeof saved[0].id !== 'string') { console.error(`Kitchen order ${order.orderId} creation failed:`, orderResponse.status); return }
    const orderId = saved[0].id
    const items = order.items.map((item) => ({ order_id: orderId, product_name: `${item.name}${item.style ? ` · ${item.style}` : ''}${item.sauce ? ` · Salsa ${item.sauce}` : ''}`, category: categoryByProduct.get(item.name) ?? 'Sin categoría', quantity: item.quantity, unit_price: item.price, notes: item.note ?? null }))
    const itemsResponse = await fetch(`${url}/rest/v1/order_items`, { method: 'POST', headers: headers(key), body: JSON.stringify(items) })
    if (!itemsResponse.ok) console.error(`Kitchen items for ${order.orderId} creation failed:`, itemsResponse.status)
  } catch (error) { console.error(`Kitchen order ${order.orderId} persistence failed:`, error) }
}

export const syncKitchenPaymentStatus = async (order: StoreOrder) => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    const response = await fetch(`${url}/rest/v1/orders?order_number=eq.${encodeURIComponent(order.orderId)}`, { method: 'PATCH', headers: headers(key), body: JSON.stringify({ payment_status: order.paymentStatus, payment_method: order.paymentMethod }) })
    if (!response.ok) console.error(`Kitchen payment status for ${order.orderId} sync failed:`, response.status)
  } catch (error) { console.error(`Kitchen payment status for ${order.orderId} sync failed:`, error) }
}

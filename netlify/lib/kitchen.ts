import type { StoreOrder } from './orders'

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

export const syncKitchenPaymentStatus = async (order: StoreOrder) => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    const response = await fetch(`${url}/rest/v1/orders?order_number=eq.${encodeURIComponent(order.orderId)}`, { method: 'PATCH', headers: headers(key), body: JSON.stringify({ payment_status: order.paymentStatus, payment_method: order.paymentMethod, culqi_order_id: order.culqiOrderId ?? null, culqi_charge_id: order.culqiChargeId ?? null }) })
    if (!response.ok) console.error(`Kitchen payment status for ${order.orderId} sync failed:`, response.status)
  } catch (error) { console.error(`Kitchen payment status for ${order.orderId} sync failed:`, error) }
}

import { notifyOrder } from '../lib/notifications'
import { createOrder } from '../lib/orders'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { message: kitchenAvailability.message })
  const body: unknown = await request.json().catch(() => null)
  const input = parseOrderInput(body, 'cash')
  if (!input) return json(400, { message: 'Los datos del pedido no son válidos.' })
  try {
    const order = await createOrder(input, 'pending')
    const notified = await notifyOrder(order)
    return json(201, { orderId: notified.orderId, paymentStatus: notified.paymentStatus })
  } catch (error) {
    console.error('Cash order registration failed:', error)
    return json(500, { message: 'No fue posible registrar el pedido.' })
  }
}

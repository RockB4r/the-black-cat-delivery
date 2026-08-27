import { notifyOrder } from '../lib/notifications'
import { createOrder } from '../lib/orders'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { getUnavailableProducts, ProductAvailabilityError } from '../lib/product-availability'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { message: kitchenAvailability.message })
  const body: unknown = await request.json().catch(() => null)
  const input = parseOrderInput(body, 'cash')
  if (!input) return json(400, { message: 'Los datos del pedido no son válidos.' })
  try {
    const unavailableProducts = await getUnavailableProducts(input.items)
    if (unavailableProducts.length) return json(409, { code: 'PRODUCT_UNAVAILABLE', unavailable_products: unavailableProducts, message: 'Uno o más productos ya no están disponibles.' })
    const order = await createOrder(input, 'pending')
    const notified = await notifyOrder(order)
    return json(201, { orderId: notified.orderId, paymentStatus: notified.paymentStatus })
  } catch (error) {
    if (error instanceof ProductAvailabilityError) return json(503, { code: 'PRODUCT_AVAILABILITY_UNAVAILABLE', message: 'No fue posible verificar la disponibilidad. Inténtalo nuevamente.' })
    console.error('Cash order registration failed:', error)
    return json(500, { message: 'No fue posible registrar el pedido.' })
  }
}

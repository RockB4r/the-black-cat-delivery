import { createOrder, linkCulqiOrder, saveOrder } from '../lib/orders'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { getUnavailableProducts, ProductAvailabilityError } from '../lib/product-availability'
import { getReservedPromotion } from '../lib/promotions'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { message: kitchenAvailability.message })
  const body: unknown = await request.json().catch(() => null)
  const input = parseOrderInput(body, 'wallet')
  const data = body as Record<string, unknown> | null
  if (!input || data?.currency !== 'PEN') return json(400, { message: 'Los datos del pedido no son válidos.' })
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) return json(500, { message: 'El pago no está disponible temporalmente.' })

  let unavailableProducts: string[]
  try {
    unavailableProducts = await getUnavailableProducts(input.items)
  } catch (error) {
    if (error instanceof ProductAvailabilityError) return json(503, { code: 'PRODUCT_AVAILABILITY_UNAVAILABLE', message: 'No fue posible verificar la disponibilidad. Inténtalo nuevamente.' })
    throw error
  }
  if (unavailableProducts.length) return json(409, { code: 'PRODUCT_UNAVAILABLE', unavailable_products: unavailableProducts, message: 'Uno o más productos ya no están disponibles.' })

  const subtotal = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const promotion = input.promotionCode ? await getReservedPromotion({ checkoutId: input.checkoutId, code: input.promotionCode, email: input.email, phone: input.phone, subtotal }) : null
  if (input.promotionCode && !promotion) return json(400, { message: 'El código de descuento ya no es válido. Vuelve a aplicarlo.' })
  const order = await createOrder(input, 'pending', promotion ? { code: promotion.code, discountPercent: promotion.discountPercent, discountAmount: promotion.discountAmount } : undefined)
  if (order.culqiOrderId) return json(200, { internalOrderId: order.databaseOrderId, orderId: order.orderId, culqiOrderId: order.culqiOrderId, paymentStatus: order.paymentStatus, amountInCents: Math.round(order.total * 100) })
  const [firstName, ...lastNameParts] = order.customer.split(/\s+/)
  const phoneNumber = order.phone.replace(/[^\d+]/g, '')
  try {
    const response = await fetch('https://api.culqi.com/v2/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(order.total * 100),
        currency_code: 'PEN',
        description: `Pedido ${order.orderId}`,
        order_number: order.orderId,
        expiration_date: Math.floor(Date.now() / 1000) + 60 * 60,
        confirm: true,
        client_details: { first_name: firstName, last_name: lastNameParts.join(' ') || 'Cliente', email: order.email, phone_number: phoneNumber },
      }),
    })
    const culqiOrder: unknown = await response.json().catch(() => null)
    if (!response.ok || typeof culqiOrder !== 'object' || culqiOrder === null || !('id' in culqiOrder) || typeof culqiOrder.id !== 'string') {
      console.error('Culqi order creation failed:', response.status, culqiOrder)
      return json(response.status, { message: 'Culqi rechazó la creación de la orden. Revisa los logs de la Function.' })
    }
    const updatedOrder = { ...order, culqiOrderId: culqiOrder.id }
    await saveOrder(updatedOrder)
    await linkCulqiOrder(culqiOrder.id, order.orderId)
    return json(201, { internalOrderId: order.databaseOrderId, orderId: order.orderId, culqiOrderId: culqiOrder.id, paymentStatus: 'pending', amountInCents: Math.round(order.total * 100) })
  } catch (error) {
    console.error('Culqi order request failed:', error)
    return json(502, { message: 'No fue posible conectar con Culqi.' })
  }
}

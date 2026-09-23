import { createOrder, linkCulqiOrder, saveOrder } from '../lib/orders'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { getUnavailableProducts, ProductAvailabilityError } from '../lib/product-availability'
import { confirmPromotionUse, getReservedPromotion } from '../lib/promotions'
import { applyGiftToOrder, getOrderGiftPayment, linkMixedCulqiOrder, reserveGiftForOrder } from '../lib/gift-cards'
import { notifyOrder } from '../lib/notifications'
import { getStore } from '@netlify/blobs'
import { matchingCulqiOrder } from '../lib/culqi-verification'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { message: kitchenAvailability.message })
  const body: unknown = await request.json().catch(() => null)
  const input = parseOrderInput(body, 'wallet')
  const data = body as Record<string, unknown> | null
  const giftPaymentCode = typeof data?.giftPaymentCode === 'string' ? data.giftPaymentCode.trim().toLowerCase() : ''
  if (giftPaymentCode && !/^[a-f0-9]{32}$/.test(giftPaymentCode)) return json(400, { message: 'Código de Gift Card inválido.' })
  if (!input || data?.currency !== 'PEN') return json(400, { message: 'Los datos del pedido no son válidos.' })
  const secretKey = process.env.CULQI_SECRET_KEY

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
  if (!order.databaseOrderId) return json(503, { message: 'El pedido aún se está registrando. Inténtalo nuevamente.' })
  let giftPayment = await getOrderGiftPayment(order.databaseOrderId)
  if (giftPaymentCode) {
    if (order.culqiOrderId && !giftPayment) return json(409, { message: 'Este pedido ya inició otro método de pago. Inicia un nuevo checkout.' })
    try {
      if (!giftPayment) await reserveGiftForOrder(order.databaseOrderId, order.checkoutId, giftPaymentCode, order.customer)
      giftPayment = await getOrderGiftPayment(order.databaseOrderId)
    } catch { return json(409, { message: 'La Gift Card no está disponible o sus datos no coinciden. Revisa el código y el beneficiario.' }) }
  } else if (giftPayment) return json(409, { message: 'Este pedido tiene una Gift Card reservada. Continúa con ese medio de pago.' })
  if (giftPayment?.status === 'applied') return json(200, { internalOrderId: order.databaseOrderId, orderId: order.orderId, paid: true, giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, amountInCents: 0 })
  if (order.paymentStatus === 'paid') return json(200, { internalOrderId: order.databaseOrderId, orderId: order.orderId, culqiOrderId: order.culqiOrderId, paymentStatus: 'paid', amountInCents: Math.round(order.total * 100) })
  if (giftPayment && giftPayment.other_amount === 0) {
    await applyGiftToOrder(order.databaseOrderId)
    const paidOrder = { ...order, paymentMethod: 'gift_card' as const, paymentStatus: 'paid' as const, giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: 0 }
    await saveOrder(paidOrder)
    if (order.discountCode) await confirmPromotionUse({ checkoutId: order.checkoutId, orderId: order.orderId })
    try { await notifyOrder(paidOrder) } catch (error) { console.error('Gift Card order notification failed:', error instanceof Error ? error.message : 'Unknown error') }
    return json(200, { internalOrderId: order.databaseOrderId, orderId: order.orderId, paid: true, giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: 0, amountInCents: 0 })
  }
  if (!secretKey) return json(500, { message: 'El pago no está disponible temporalmente.' })
  const amountInCents = Math.round((giftPayment?.other_amount ?? order.total) * 100)
  if (order.culqiOrderId) return json(200, { internalOrderId: order.databaseOrderId, orderId: order.orderId, culqiOrderId: order.culqiOrderId, paymentStatus: order.paymentStatus, amountInCents })
  const mixedLock = giftPayment ? getStore({ name: 'the-black-cat-gift-culqi-order-locks', consistency: 'strong' }) : null
  if (mixedLock) {
    const lock = await mixedLock.set(order.checkoutId, 'processing', { onlyIfNew: true })
    if (!lock.modified) return json(409, { message: 'El pago complementario se está preparando. Espera unos segundos y consulta el pedido.' })
  }
  const [firstName, ...lastNameParts] = order.customer.split(/\s+/)
  const phoneNumber = order.phone.replace(/[^\d+]/g, '')
  try {
    const response = await fetch('https://api.culqi.com/v2/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: amountInCents,
        currency_code: 'PEN',
        description: `Pedido ${order.orderId}`,
        order_number: order.orderId,
        expiration_date: Math.floor(Date.now() / 1000) + 60 * 60,
        confirm: true,
        client_details: { first_name: firstName, last_name: lastNameParts.join(' ') || 'Cliente', email: order.email, phone_number: phoneNumber },
      }),
    })
    const culqiOrder: unknown = await response.json().catch(() => null)
    const returnedId = typeof culqiOrder === 'object' && culqiOrder !== null && 'id' in culqiOrder && typeof culqiOrder.id === 'string' ? culqiOrder.id : ''
    if (!response.ok || !returnedId.startsWith('ord_') || !matchingCulqiOrder(culqiOrder, { id: returnedId, orderNumber: order.orderId, amountInCents })) {
      if (mixedLock && response.status >= 400 && response.status < 500) await mixedLock.delete(order.checkoutId)
      console.error('Culqi order creation failed:', response.status)
      return json(response.status, { message: 'Culqi rechazó la creación de la orden. Revisa los logs de la Function.' })
    }
    const updatedOrder = { ...order, culqiOrderId: returnedId,
      ...(giftPayment ? { paymentMethod: 'gift_card_culqi' as const, giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, otherPaymentMethod: 'culqi' } : {}) }
    if (giftPayment) await linkMixedCulqiOrder(order.databaseOrderId, returnedId)
    await linkCulqiOrder(returnedId, order.orderId)
    await saveOrder(updatedOrder)
    return json(201, { internalOrderId: order.databaseOrderId, orderId: order.orderId, culqiOrderId: returnedId, paymentStatus: 'pending', amountInCents })
  } catch (error) {
    console.error('Culqi order request failed:', error)
    return json(502, { message: 'No fue posible conectar con Culqi.' })
  }
}

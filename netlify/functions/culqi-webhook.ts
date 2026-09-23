import { notifyOrder } from '../lib/notifications'
import { getOrder, getOrderIdByCulqiOrder, saveOrder } from '../lib/orders'
import { confirmPromotionUse, releasePromotion } from '../lib/promotions'
import { applyGiftToOrder, finalizeGiftPurchase, getGiftPurchaseByCulqiOrder, getLinkedMixedCulqiCharge, getOrderGiftPayment, markMixedCulqiExpired, releaseGiftReservation, setGiftPaymentState } from '../lib/gift-cards'
import { confirmedCulqiOrder, expiredCulqiOrder } from '../lib/culqi-verification'

const response = (status: number) => new Response(null, { status })

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return response(405)
  const event: unknown = await request.json().catch(() => null)
  const data = event && typeof event === 'object' ? event as Record<string, unknown> : null
  const eventData = data?.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : data
  const culqiOrderId = typeof eventData?.id === 'string' ? eventData.id : ''
  if (!culqiOrderId.startsWith('ord_')) return response(400)

  // We verify the event against Culqi's authenticated Orders API before updating the order.
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) return response(500)
  try {
    const culqiResponse = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(culqiOrderId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
    const culqiOrder: unknown = await culqiResponse.json().catch(() => null)
    if (!culqiResponse.ok || typeof culqiOrder !== 'object' || culqiOrder === null) return response(400)
    const state = 'state' in culqiOrder && typeof culqiOrder.state === 'string' ? culqiOrder.state : ''
    const giftPurchase = await getGiftPurchaseByCulqiOrder(culqiOrderId)
    if (giftPurchase) {
      const expected = { id: culqiOrderId, orderNumber: `GC-${giftPurchase.checkout_id}`, amountInCents: Math.round(Number(giftPurchase.amount) * 100) }
      if (state === 'paid' && !confirmedCulqiOrder(culqiOrder, expected)) return response(400)
      if (state === 'paid') await finalizeGiftPurchase(giftPurchase, giftPurchase.culqi_charge_id)
      return response(200)
    }
    const internalOrderId = await getOrderIdByCulqiOrder(culqiOrderId)
    if (!internalOrderId) return response(204)
    const order = await getOrder(internalOrderId)
    if (!order) return response(204)
    const giftPayment = order.databaseOrderId ? await getOrderGiftPayment(order.databaseOrderId) : null
    const expected = { id: culqiOrderId, orderNumber: order.orderId, amountInCents: Math.round(Number(giftPayment?.other_amount ?? order.total) * 100) }
    if (state === 'paid' && !confirmedCulqiOrder(culqiOrder, expected)) return response(400)
    if (state === 'expired' && !expiredCulqiOrder(culqiOrder, expected)) return response(400)
    if (state === 'paid' && order.paymentStatus !== 'paid') {
      const operationId = 'id' in culqiOrder && typeof culqiOrder.id === 'string' ? culqiOrder.id : undefined
      if (giftPayment) {
        await setGiftPaymentState(giftPayment.order_id, 'paid')
        await applyGiftToOrder(giftPayment.order_id, operationId ?? culqiOrderId)
      }
      const paidOrder = { ...order, paymentStatus: 'paid' as const, culqiOrderId: operationId ?? order.culqiOrderId,
        ...(giftPayment ? { paymentMethod: 'gift_card_culqi' as const, giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, otherPaymentMethod: 'culqi' } : {}) }
      await saveOrder(paidOrder)
      if (paidOrder.discountCode) await confirmPromotionUse({ checkoutId: paidOrder.checkoutId, orderId: paidOrder.orderId })
      await notifyOrder(paidOrder)
    } else if (state === 'expired' && order.paymentStatus === 'pending') {
      if (giftPayment) {
        if (await getLinkedMixedCulqiCharge(giftPayment.order_id)) {
          await setGiftPaymentState(giftPayment.order_id, 'reconciliation_required')
          console.error('Gift Card mixed payment requires charge reconciliation before release')
          return response(200)
        }
        await markMixedCulqiExpired(giftPayment.order_id)
        await setGiftPaymentState(giftPayment.order_id, 'expired')
        await releaseGiftReservation(giftPayment.order_id)
      }
      await saveOrder({ ...order, paymentStatus: 'expired' })
      if (order.discountCode) await releasePromotion(order.checkoutId)
    }
    return response(200)
  } catch (error) {
    console.error('Culqi webhook processing failed:', error)
    return response(500)
  }
}

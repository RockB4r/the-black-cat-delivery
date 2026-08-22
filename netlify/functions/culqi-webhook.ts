import { notifyOrder } from '../lib/notifications'
import { getOrder, getOrderIdByCulqiOrder, saveOrder } from '../lib/orders'

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
    const internalOrderId = await getOrderIdByCulqiOrder(culqiOrderId)
    if (!internalOrderId) return response(204)
    const order = await getOrder(internalOrderId)
    if (!order) return response(204)
    if (state === 'paid' && order.paymentStatus !== 'paid') {
      const operationId = 'id' in culqiOrder && typeof culqiOrder.id === 'string' ? culqiOrder.id : undefined
      const paidOrder = { ...order, paymentStatus: 'paid' as const, culqiOrderId: operationId ?? order.culqiOrderId }
      await saveOrder(paidOrder)
      await notifyOrder(paidOrder)
    } else if (state === 'expired' && order.paymentStatus === 'pending') {
      await saveOrder({ ...order, paymentStatus: 'expired' })
    }
    return response(200)
  } catch (error) {
    console.error('Culqi webhook processing failed:', error)
    return response(500)
  }
}

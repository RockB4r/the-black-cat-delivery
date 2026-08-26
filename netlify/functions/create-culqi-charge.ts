import { notifyOrder } from '../lib/notifications'
import { getOrderByCheckoutId, trustedItems } from '../lib/orders'
import { getStore } from '@netlify/blobs'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { approved: false, message: 'Método no permitido.' })
  }
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { approved: false, message: kitchenAvailability.message })

  const body: unknown = await request.json().catch(() => null)
  const data = body as Record<string, unknown> | null
  const token = typeof data?.token === 'string' ? data.token.trim() : ''
  const internalOrderId = typeof data?.internalOrderId === 'string' ? data.internalOrderId.trim() : ''
  const input = parseOrderInput(body, 'card')
  const validated = trustedItems(data?.items)
  const amount = data?.amount
  if (!token || !input || !validated || !Number.isSafeInteger(amount) || amount !== validated.total * 100 || data?.currency !== 'PEN') return json(400, { approved: false, message: 'Los datos de pago no son válidos.' })

  const order = await getOrderByCheckoutId(input.checkoutId)
  if (!order || order.paymentStatus === 'expired' || !internalOrderId || order.databaseOrderId !== internalOrderId) return json(409, { approved: false, message: 'Este intento de pago ya no está disponible. Inicia un nuevo pedido.' })
  if (order.paymentStatus === 'paid') return json(200, { approved: true, chargeId: order.culqiChargeId, orderId: order.orderId })
  if (order.total !== validated.total || order.email !== input.email || order.checkoutId !== input.checkoutId) return json(409, { approved: false, message: 'Los datos del intento de pago no coinciden. Inicia un nuevo pedido.' })

  const paymentLock = await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).set(`${input.checkoutId}/card`, new Date().toISOString(), { onlyIfNew: true })
  if (!paymentLock.modified) return json(409, { approved: false, message: 'Este pago ya se está procesando. Espera unos segundos antes de reintentar.' })

  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) {
    await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(`${input.checkoutId}/card`)
    console.error('CULQI_SECRET_KEY is not configured.')
    return json(500, { approved: false, message: 'El pago no está disponible temporalmente.' })
  }

  try {
    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency_code: 'PEN',
        email: order.email,
        description: `Pedido ${order.orderId}`,
        source_id: token,
        capture: true,
      }),
    })

    const culqiData: unknown = await culqiResponse.json().catch(() => null)
    if (!culqiResponse.ok) {
      if (culqiResponse.status >= 400 && culqiResponse.status < 500) {
        await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(`${input.checkoutId}/card`)
        return json(402, { approved: false, message: 'El pago fue rechazado. Verifica tus datos o intenta otro método.' })
      }

      console.error('Culqi charge request failed with status:', culqiResponse.status)
      await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(`${input.checkoutId}/card`)
      return json(502, { approved: false, message: 'No fue posible procesar el pago. Inténtalo nuevamente.' })
    }

    const chargeId = typeof culqiData === 'object' && culqiData !== null && 'id' in culqiData && typeof culqiData.id === 'string'
      ? culqiData.id
      : undefined

    if (!chargeId) throw new Error('Culqi did not return a charge identifier.')
    const notified = await notifyOrder({ ...order, paymentMethod: 'card', paymentStatus: 'paid', culqiChargeId: chargeId })
    return json(200, { approved: true, chargeId, orderId: notified.orderId })
  } catch (error) {
    await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(`${input.checkoutId}/card`)
    console.error('Culqi charge request failed:', error)
    return json(502, { approved: false, message: 'No fue posible conectar con el servicio de pago. Inténtalo nuevamente.' })
  }
}

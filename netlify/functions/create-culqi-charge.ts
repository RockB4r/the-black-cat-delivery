import { notifyOrder } from '../lib/notifications'
import { createOrder, trustedItems } from '../lib/orders'
import { json, parseOrderInput } from '../lib/request'
import { isOnlineOrderingOpen } from '../lib/online-ordering'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { approved: false, message: 'Método no permitido.' })
  }
  if (!isOnlineOrderingOpen()) return json(403, { approved: false, message: 'Cocina Cerrada. Nuestro horario de atención online es: 6:00 PM - 1:00 AM.' })

  const body: unknown = await request.json().catch(() => null)
  const data = body as Record<string, unknown> | null
  const token = typeof data?.token === 'string' ? data.token.trim() : ''
  const input = parseOrderInput(body, 'card')
  const validated = trustedItems(data?.items)
  const amount = data?.amount
  if (!token || !input || !validated || !Number.isSafeInteger(amount) || amount !== validated.total * 100 || data?.currency !== 'PEN') return json(400, { approved: false, message: 'Los datos de pago no son válidos.' })

  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) {
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
        email: input.email,
        description: `Pedido The Black Cat Rock Bar`,
        source_id: token,
        capture: true,
      }),
    })

    const culqiData: unknown = await culqiResponse.json().catch(() => null)
    if (!culqiResponse.ok) {
      if (culqiResponse.status >= 400 && culqiResponse.status < 500) {
        return json(402, { approved: false, message: 'El pago fue rechazado. Verifica tus datos o intenta otro método.' })
      }

      console.error('Culqi charge request failed with status:', culqiResponse.status)
      return json(502, { approved: false, message: 'No fue posible procesar el pago. Inténtalo nuevamente.' })
    }

    const chargeId = typeof culqiData === 'object' && culqiData !== null && 'id' in culqiData && typeof culqiData.id === 'string'
      ? culqiData.id
      : undefined

    const order = await createOrder(input, 'paid')
    const notified = await notifyOrder({ ...order, culqiChargeId: chargeId })
    return json(200, { approved: true, chargeId, orderId: notified.orderId })
  } catch (error) {
    console.error('Culqi charge request failed:', error)
    return json(502, { approved: false, message: 'No fue posible conectar con el servicio de pago. Inténtalo nuevamente.' })
  }
}

import menuData from '../../src/data/menu.json'

type PaymentItem = {
  name: unknown
  quantity: unknown
}

type ChargeRequest = {
  token?: unknown
  amount?: unknown
  currency?: unknown
  email?: unknown
  description?: unknown
  items?: unknown
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const catalogPrices = new Map(
  menuData.flatMap((category) => category.items.map((item) => [item.name, item.price] as const)),
)

const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const getTrustedAmount = (items: unknown): number | null => {
  if (!Array.isArray(items) || items.length === 0) return null

  let amount = 0
  for (const item of items as PaymentItem[]) {
    const quantity = item.quantity
    if (typeof item.name !== 'string' || typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) return null
    const price = catalogPrices.get(item.name)
    if (price === undefined) return null
    amount += price * quantity * 100
  }

  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { approved: false, message: 'Método no permitido.' })
  }

  let body: ChargeRequest
  try {
    body = await request.json() as ChargeRequest
  } catch {
    return jsonResponse(400, { approved: false, message: 'La solicitud de pago no es válida.' })
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const amount = body.amount
  const currency = body.currency
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const description = typeof body.description === 'string'
    ? body.description.trim().slice(0, 160)
    : 'Pedido The Black Cat Rock Bar'

  if (!token || !Number.isSafeInteger(amount) || amount <= 0 || currency !== 'PEN' || !emailPattern.test(email)) {
    return jsonResponse(400, { approved: false, message: 'Los datos de pago no son válidos.' })
  }

  // El catálogo se evalúa en el servidor. Cuando exista una base de datos, esta validación
  // se reemplazará por una orden previamente guardada y un total calculado en el backend.
  const trustedAmount = getTrustedAmount(body.items)
  if (trustedAmount === null || trustedAmount !== amount) {
    return jsonResponse(400, { approved: false, message: 'El total del pedido no pudo validarse.' })
  }

  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) {
    console.error('CULQI_SECRET_KEY is not configured.')
    return jsonResponse(500, { approved: false, message: 'El pago no está disponible temporalmente.' })
  }

  try {
    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: trustedAmount,
        currency_code: 'PEN',
        email,
        description,
        source_id: token,
        capture: true,
      }),
    })

    const culqiData: unknown = await culqiResponse.json().catch(() => null)
    if (!culqiResponse.ok) {
      if (culqiResponse.status >= 400 && culqiResponse.status < 500) {
        return jsonResponse(402, { approved: false, message: 'El pago fue rechazado. Verifica tus datos o intenta otro método.' })
      }

      console.error('Culqi charge request failed with status:', culqiResponse.status)
      return jsonResponse(502, { approved: false, message: 'No fue posible procesar el pago. Inténtalo nuevamente.' })
    }

    const chargeId = typeof culqiData === 'object' && culqiData !== null && 'id' in culqiData && typeof culqiData.id === 'string'
      ? culqiData.id
      : undefined

    return jsonResponse(200, { approved: true, chargeId })
  } catch (error) {
    console.error('Culqi charge request failed:', error)
    return jsonResponse(502, { approved: false, message: 'No fue posible conectar con el servicio de pago. Inténtalo nuevamente.' })
  }
}

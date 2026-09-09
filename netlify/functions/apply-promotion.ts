import { json, parseOrderInput } from '../lib/request'
import { reservePromotion } from '../lib/promotions'

const messageFor = (reason: string, minimumSubtotal?: number) => {
  if (reason === 'minimum_not_met') return `Este código requiere una compra mínima de S/ ${(minimumSubtotal ?? 30).toFixed(2)}.`
  if (reason === 'customer_limit') return 'Ya alcanzaste el límite de usos de este código.'
  if (reason === 'campaign_limit') return 'Este código ya alcanzó su límite de usos.'
  return 'El código no está disponible o ya venció.'
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const body: unknown = await request.json().catch(() => null)
  const input = parseOrderInput(body, 'cash')
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const code = typeof data?.promotionCode === 'string' ? data.promotionCode : ''
  if (!input || !code) return json(400, { message: 'Ingresa un código válido y completa tus datos de contacto.' })
  try {
    const subtotal = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const result = await reservePromotion({ code, checkoutId: input.checkoutId, email: input.email, phone: input.phone, subtotal })
    if (!result.accepted) return json(400, { message: messageFor(result.reason) })
    return json(200, result.promotion)
  } catch (error) {
    console.error('Promotion application failed:', error)
    return json(500, { message: 'No fue posible validar el código. Inténtalo nuevamente.' })
  }
}

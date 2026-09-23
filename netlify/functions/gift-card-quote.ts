import { giftCardQuote } from '../lib/gift-cards'
import { json } from '../lib/request'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const data: unknown = await request.json().catch(() => null)
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const code = typeof body.paymentCode === 'string' ? body.paymentCode.trim().toLowerCase() : ''
  if (!/^[a-f0-9]{32}$/.test(code)) return json(400, { message: 'No se pudo validar la Gift Card.' })
  try {
    const quote = await giftCardQuote(code)
    if (!quote) return json(404, { message: 'No se pudo validar la Gift Card.' })
    return json(200, quote)
  } catch (error) {
    console.error('Gift Card quote failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(503, { message: 'No fue posible consultar la Gift Card.' })
  }
}

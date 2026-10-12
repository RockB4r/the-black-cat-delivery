import { publicGiftCard } from '../lib/gift-cards'
import { json } from '../lib/request'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json(405, { message: 'Método no permitido.' })
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!/^[a-f0-9]{64}$/.test(token)) return json(404, { message: 'Gift Card no encontrada.' })
  try {
    const card = await publicGiftCard(token)
    if (!card) return json(404, { message: 'Gift Card no encontrada.' })
    const status = card.status === 'active' && card.expires_at && new Date(card.expires_at).getTime() <= Date.now() ? 'expired' : card.status
    return json(200, {
      code: card.code, paymentCode: card.online_payment_code,
      purchaserName: card.purchaser_name, recipientName: card.recipient_name, message: card.gift_message,
      originalAmount: Number(card.initial_balance), balance: Number(card.current_balance),
      activatedAt: card.activated_at, expiresAt: card.expires_at, status,
    })
  } catch (error) {
    console.error('Public Gift Card lookup failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(503, { message: 'No fue posible consultar la Gift Card.' })
  }
}

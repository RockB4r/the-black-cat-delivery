import { json } from '../lib/request'
import { confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder } from '../lib/culqi-verification'
import { clearMixedCulqiAttempt, completeMixedCulqiAttempt, getMixedCulqiAttempts, getOrderGiftPayment } from '../lib/gift-cards'
import { getOrder, saveOrder } from '../lib/orders'

type ResolutionInput = { orderId?: unknown; attemptId?: unknown; decision?: unknown; chargeId?: unknown; note?: unknown; confirmNoCharge?: unknown }

const adminIdentity = async (request: Request): Promise<string | null> => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const authorization = request.headers.get('authorization')
  if (!url || !key || !authorization?.startsWith('Bearer ')) return null
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } })
  if (!userResponse.ok) return null
  const user: unknown = await userResponse.json().catch(() => null)
  const userId = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : null
  if (!userId) return null
  const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,active`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!profileResponse.ok) return null
  const profiles: unknown = await profileResponse.json().catch(() => null)
  return Array.isArray(profiles) && profiles.some((profile) => profile && typeof profile === 'object' && profile.active === true && (profile.role === 'admin' || profile.role === 'manager')) ? userId : null
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const actor = await adminIdentity(request)
  if (!actor) return json(403, { message: 'Solo Admin o Manager puede conciliar un pago mixto.' })
  const body: unknown = await request.json().catch(() => null)
  const input = body && typeof body === 'object' ? body as ResolutionInput : {}
  const orderId = typeof input.orderId === 'string' ? input.orderId : ''
  const attemptId = typeof input.attemptId === 'string' ? input.attemptId : ''
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : ''
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[0-9a-f-]{36}$/i.test(attemptId) || note.length < 12) return json(400, { message: 'Pedido, intento y justificación son obligatorios.' })
  const attempts = await getMixedCulqiAttempts(orderId)
  const attempt = attempts.find((candidate) => candidate.id === attemptId)
  if (!attempt || attempt.order_id !== orderId) return json(404, { message: 'Intento no encontrado.' })
  const payment = await getOrderGiftPayment(orderId)
  if (!payment || payment.checkout_id !== attempt.checkout_id || Number(payment.other_amount) !== Number(attempt.culqi_amount)) return json(409, { message: 'La reserva no coincide.' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!url || !key || !secretKey) return json(503, { message: 'La conciliación no está configurada.' })
  const orderResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=order_number,culqi_order_id,culqi_charge_id,payment_status`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows: unknown = await orderResponse.json().catch(() => null)
  const row = Array.isArray(rows) ? rows[0] : null
  if (!orderResponse.ok || !row || typeof row.order_number !== 'string' || typeof row.culqi_order_id !== 'string' || row.culqi_order_id !== attempt.culqi_order_id) return json(409, { message: 'El pedido no coincide.' })
  const stored = await getOrder(row.order_number)
  if (!stored) return json(409, { message: 'El pedido no está disponible para conciliación.' })

  if (input.decision === 'paid') {
    const chargeId = typeof input.chargeId === 'string' ? input.chargeId.trim() : ''
    if (!/^chr_test_[A-Za-z0-9]+$/.test(chargeId)) return json(400, { message: 'Se requiere el ID de un cargo Culqi TEST.' })
    const chargeResponse = await fetch(`https://api.culqi.com/v2/charges/${encodeURIComponent(chargeId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
    const charge: unknown = await chargeResponse.json().catch(() => null)
    if (!chargeResponse.ok || !confirmedCulqiCharge(charge, { id: chargeId, amountInCents: Math.round(Number(payment.other_amount) * 100), description: `Pedido ${row.order_number}`, checkoutId: payment.checkout_id, allowMissingStatus: true })) return json(409, { message: 'No se pudo verificar que el cargo corresponda al pedido.' })
    const result = await completeMixedCulqiAttempt(orderId, attemptId, chargeId, chargeId, 'manual_verified', actor, note)
    await saveOrder({ ...stored, paymentStatus: 'paid', paymentMethod: 'gift_card_culqi', culqiChargeId: chargeId, giftCardAmount: Number(payment.gift_amount), otherPaymentAmount: Number(payment.other_amount), otherPaymentMethod: 'culqi' })
    return json(200, { resolved: true, idempotent: result.idempotent, orderId: row.order_number })
  }

  if (input.decision === 'no_charge') {
    if (input.confirmNoCharge !== true || row.culqi_charge_id) return json(400, { message: 'Confirma en Culqi TEST que no existe cargo aprobado.' })
    const culqiResponse = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(row.culqi_order_id)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
    const culqiOrder: unknown = await culqiResponse.json().catch(() => null)
    const expected = { id: row.culqi_order_id, orderNumber: row.order_number, amountInCents: Math.round(Number(payment.other_amount) * 100) }
    if (!culqiResponse.ok || confirmedCulqiOrder(culqiOrder, expected) || !expiredCulqiOrder(culqiOrder, expected)) return json(409, { message: 'La orden Culqi no está terminalmente expirada.' })
    await clearMixedCulqiAttempt(orderId, attemptId, actor, note)
    await saveOrder({ ...stored, paymentStatus: 'expired' })
    return json(200, { resolved: true, orderId: row.order_number })
  }
  return json(400, { message: 'Decisión no válida.' })
}

import { json } from '../lib/request'
import { evaluateReconciledChargeResponse, getCulqiEnvironment, validateCulqiChargeId, validateCulqiOrderId } from '../lib/culqi-verification'
import { verifyCulqiNoCharge } from '../lib/culqi-no-charge'
import { clearMixedCulqiAttempt, completeMixedCulqiAttempt, getMixedCulqiAttempts, getOrderGiftPayment, markMixedCulqiAttempt } from '../lib/gift-cards'
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
  if (!getCulqiEnvironment()) return new Response(null, { status: 503 })
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
  if (!url || !key || !getCulqiEnvironment(secretKey)) return json(503, { message: 'La conciliación no está configurada.' })
  const orderResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=order_number,checkout_id,gift_card_id,gift_card_amount,other_payment_amount,total,culqi_order_id,culqi_charge_id,payment_status`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const rows: unknown = await orderResponse.json().catch(() => null)
  const row = Array.isArray(rows) ? rows[0] : null
  if (!orderResponse.ok || !row || typeof row.order_number !== 'string' || typeof row.culqi_order_id !== 'string' || row.culqi_order_id !== attempt.culqi_order_id) return json(409, { message: 'El pedido no coincide.' })
  const stored = await getOrder(row.order_number)
  if (!validateCulqiOrderId(row.culqi_order_id)) return json(409, { message: 'La orden no pertenece al entorno Culqi configurado.' })
  if (!stored) return json(409, { message: 'El pedido no está disponible para conciliación.' })

  if (input.decision === 'paid') {
    const chargeId = typeof input.chargeId === 'string' ? input.chargeId.trim() : ''
    if (!validateCulqiChargeId(chargeId)) return json(400, { message: 'Se requiere un cargo del entorno Culqi configurado.' })
    const chargeResponse = await fetch(`https://api.culqi.com/v2/charges/${encodeURIComponent(chargeId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
    const charge: unknown = await chargeResponse.json().catch(() => null)
    const evidence = evaluateReconciledChargeResponse(charge, { id: chargeId, amountInCents: Math.round(Number(payment.other_amount) * 100), description: `Pedido ${row.order_number}`, checkoutId: payment.checkout_id }, chargeResponse.status)
    if (evidence !== 'approved') {
      if (evidence === 'ambiguous' && attempt.status === 'processing') await markMixedCulqiAttempt(attemptId, 'reconciliation_required', 'manual_get_ambiguous')
      return json(409, { message: 'El cargo no tiene evidencia suficiente de aprobación. La reserva se conserva.' })
    }
    const result = await completeMixedCulqiAttempt(orderId, attemptId, chargeId, chargeId, 'manual_verified', actor, note)
    await saveOrder({ ...stored, paymentStatus: 'paid', paymentMethod: 'gift_card_culqi', culqiChargeId: chargeId, giftCardAmount: Number(payment.gift_amount), otherPaymentAmount: Number(payment.other_amount), otherPaymentMethod: 'culqi' })
    return json(200, { resolved: true, idempotent: result.idempotent, orderId: row.order_number })
  }

  if (input.decision === 'no_charge') {
    if (input.confirmNoCharge !== true || row.culqi_charge_id) return json(400, { message: 'Confirma en Culqi que no existe cargo aprobado.' })
    if (payment.order_id !== orderId || row.checkout_id !== payment.checkout_id || row.gift_card_id !== payment.gift_card_id
      || Number(row.gift_card_amount) !== Number(payment.gift_amount) || Number(attempt.gift_amount) !== Number(payment.gift_amount)
      || Number(row.other_payment_amount) !== Number(payment.other_amount)
      || Number(row.total) !== Number(payment.gift_amount) + Number(payment.other_amount)
      || !['pending', 'failed', 'expired'].includes(row.payment_status)
      || stored.checkoutId !== payment.checkout_id || stored.paymentStatus === 'paid'
      || stored.culqiChargeId || stored.culqiOrderId !== row.culqi_order_id
      || stored.total !== Number(row.total)
      || attempts.some((candidate) => candidate.culqi_charge_id || candidate.status === 'approved'
        || candidate.id !== attemptId && ['processing', 'reconciliation_required'].includes(candidate.status))) {
      return json(409, { message: 'La operación no es elegible para resolución sin cobro.' })
    }
    const historyResponse = await fetch(`${url}/rest/v1/gift_card_transactions?order_id=eq.${encodeURIComponent(orderId)}&movement_type=eq.redemption&select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    const history: unknown = await historyResponse.json().catch(() => null)
    if (!historyResponse.ok || !Array.isArray(history) || history.length) return json(409, { message: 'No se pudo descartar un canje previo. La reserva se conserva.' })
    if (attempt.status === 'cleared_no_charge' && payment.status === 'released' && row.payment_status === 'expired') {
      return json(200, { resolved: true, idempotent: true, orderId: row.order_number })
    }
    if (payment.status !== 'reserved' || ['paid', 'applied'].includes(payment.payment_state)
      || !['processing', 'reconciliation_required', 'rejected'].includes(attempt.status)) {
      return json(409, { message: 'El intento o la reserva ya no admite conciliación.' })
    }
    let noCharge = false
    try {
      noCharge = await verifyCulqiNoCharge(secretKey!, { id: row.culqi_order_id, orderNumber: row.order_number,
        amountInCents: Math.round(Number(payment.other_amount) * 100), checkoutId: payment.checkout_id,
        databaseOrderId: orderId, attemptIds: attempts.map((candidate) => candidate.id), since: payment.reserved_at })
    } catch { /* Provider/network uncertainty must not write financial state. */ }
    if (!noCharge) return json(409, { message: 'Sin evidencia terminal suficiente de no cobro. La reserva se conserva.' })
    const cleared = await clearMixedCulqiAttempt(orderId, attemptId, actor, note)
    if (cleared !== true) return json(409, { message: 'La conciliación no fue confirmada. No repitas la operación.' })
    await saveOrder({ ...stored, paymentStatus: 'expired' })
    return json(200, { resolved: true, orderId: row.order_number })
  }
  return json(400, { message: 'Decisión no válida.' })
}

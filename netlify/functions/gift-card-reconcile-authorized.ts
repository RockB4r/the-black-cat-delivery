import { json } from '../lib/request'
import { getCulqiEnvironment, validateCulqiChargeId } from '../lib/culqi-verification'
import { verifyExternallyAuthorizedCharge } from '../lib/external-authorized-reconciliation'
import { getOrder, saveOrder } from '../lib/orders'

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.CULQI_SECRET_KEY
  if (url !== 'https://kqfphrukxdvlrbjipjnx.supabase.co' || !key || getCulqiEnvironment(secret) !== 'test') return json(503, { message: 'Solo staging TEST.' })
  try {
    const auth = request.headers.get('authorization')
    if (!auth?.startsWith('Bearer ')) return json(403, { message: 'Admin o Manager activo requerido.' })
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    const read = async (path: string) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw Error('Database read unavailable')
      return await r.json()
    }
    const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth }, signal: AbortSignal.timeout(15000) })
    const user = await u.json().catch(() => null)
    if (!u.ok || !uuid.test(user?.id ?? '')) return json(403, { message: 'Sesión no autorizada.' })
    const profiles = await read(`staff_profiles?user_id=eq.${user.id}&select=role,active`)
    if (!Array.isArray(profiles) || !profiles.some(p => p.active === true && ['admin', 'manager'].includes(p.role))) return json(403, { message: 'Admin o Manager activo requerido.' })
    const b = await request.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['attempt_id', 'checkout_id', 'charge_id'].includes(k))
      || !uuid.test(b.attempt_id ?? '') || !uuid.test(b.checkout_id ?? '') || !validateCulqiChargeId(b.charge_id, 'test')) return json(400, { message: 'Identificadores no válidos.' })
    const attempts = await read(`gift_card_culqi_attempts?id=eq.${b.attempt_id}&select=id,checkout_id,order_id,culqi_order_id,status,resolution_source`)
    const a = Array.isArray(attempts) && attempts.length === 1 ? attempts[0] : null
    if (!a || a.checkout_id !== b.checkout_id || !uuid.test(a.order_id ?? '')
      || !(a.status === 'rejected' && a.resolution_source === 'culqi_body_rejected'
        || a.status === 'approved' && a.resolution_source === 'external_authorized_reconciliation')) return json(409, { message: 'Intento no elegible.' })
    const rows = await read(`orders?id=eq.${a.order_id}&select=id,order_number,checkout_id,culqi_order_id,total,gift_card_amount,other_payment_amount`)
    const o = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
    if (!o || o.checkout_id !== b.checkout_id || o.culqi_order_id !== a.culqi_order_id || !/^ord_test_[A-Za-z0-9]+$/.test(o.culqi_order_id)
      || o.total !== 50 || o.gift_card_amount !== 40 || o.other_payment_amount !== 10) return json(409, { message: 'Pedido no elegible.' })
    const evidence = await verifyExternallyAuthorizedCharge(secret!, { orderId: o.id, orderNumber: o.order_number,
      checkoutId: b.checkout_id, attemptId: b.attempt_id, chargeId: b.charge_id, culqiOrderId: o.culqi_order_id })
    const response = await fetch(`${url}/rest/v1/rpc/reconcile_externally_authorized_mixed_attempt`, { method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ p_attempt_id: b.attempt_id, p_checkout_id: b.checkout_id, p_charge_id: b.charge_id, p_actor: user.id, p_evidence: evidence }) })
    if (!response.ok) return json(409, { message: 'Conciliación no confirmada. No repitas; verifica el estado.' })
    const result = await response.json()
    // DB is authoritative; cache failure never retries the financial transaction.
    try {
      const stored = await getOrder(o.order_number)
      if (!stored || stored.checkoutId !== b.checkout_id || stored.total !== 50 || stored.culqiOrderId !== o.culqi_order_id
        || stored.culqiChargeId && stored.culqiChargeId !== b.charge_id) throw Error('Cache mismatch')
      await saveOrder({ ...stored, paymentStatus: 'paid', paymentMethod: 'gift_card_culqi', culqiChargeId: b.charge_id,
        giftCardAmount: 40, otherPaymentAmount: 10, otherPaymentMethod: 'culqi' })
    } catch { return json(200, { ...result, cacheSyncPending: true }) }
    return json(200, { ...result, cacheSyncPending: false })
  } catch { return json(409, { message: 'Evidencia o resultado incierto. No repitas; verifica el estado.' }) }
}

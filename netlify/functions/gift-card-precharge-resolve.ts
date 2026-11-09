import { json } from '../lib/request'
import { getCulqiEnvironment } from '../lib/culqi-verification'
import { verifyPrechargeZeroCharges } from '../lib/precharge-resolution'
import { getOrder, saveOrder } from '../lib/orders'

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.CULQI_SECRET_KEY
  if (url !== 'https://kqfphrukxdvlrbjipjnx.supabase.co' || !key || getCulqiEnvironment(secret) !== 'test') return json(503, { message: 'Solo staging TEST.' })
  try {
    const auth = request.headers.get('authorization')
    if (!auth?.startsWith('Bearer ')) return json(403, { message: 'Admin o Manager activo requerido.' })
    const read = async (path: string) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error('Database read unavailable')
      return await r.json()
    }
    const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth }, signal: AbortSignal.timeout(15000) })
    const user = await u.json().catch(() => null)
    if (!u.ok || !uuid.test(user?.id ?? '')) return json(403, { message: 'Sesión no autorizada.' })
    const profiles = await read(`staff_profiles?user_id=eq.${user.id}&select=role,active`)
    if (!Array.isArray(profiles) || !profiles.some(p => p.active === true && ['admin','manager'].includes(p.role))) return json(403, { message: 'Admin o Manager activo requerido.' })
    const b = await request.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['orderId','checkoutId','note'].includes(k))
      || !uuid.test(b.orderId ?? '') || !uuid.test(b.checkoutId ?? '') || typeof b.note !== 'string' || b.note.trim().length < 12 || b.note.length > 1000) return json(400, { message: 'Pedido, checkout y justificación requeridos.' })
    const rows = await read(`orders?id=eq.${b.orderId}&select=id,order_number,checkout_id,culqi_order_id,other_payment_amount`)
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
    if (!row || row.checkout_id !== b.checkoutId || typeof row.culqi_order_id !== 'string' || !row.culqi_order_id.startsWith('ord_test_')
      || !Number.isSafeInteger(Math.round(Number(row.other_payment_amount)*100)) || Number(row.other_payment_amount)<=0) return json(409, { message: 'Pedido no elegible.' })
    const evidence = await verifyPrechargeZeroCharges(secret!, { id: row.culqi_order_id, orderNumber: row.order_number, amountInCents: Math.round(Number(row.other_payment_amount)*100), checkoutId: b.checkoutId, databaseOrderId: row.id })
    const r = await fetch(`${url}/rest/v1/rpc/resolve_precharge_gift_card_order`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_order_id: row.id, p_checkout_id: b.checkoutId, p_actor: user.id, p_note: b.note.trim(), p_evidence: evidence }), signal: AbortSignal.timeout(20000) })
    if (!r.ok) return json(409, { message: 'Resolución no confirmada. No repitas; verifica el estado.' })
    const result = await r.json()
    // DB result is authoritative. Cache sync is safely repeatable and cannot release twice.
    try {
      const stored = await getOrder(row.order_number)
      if (!stored || stored.checkoutId !== b.checkoutId || stored.paymentStatus === 'paid') throw new Error('Cache mismatch')
      await saveOrder({ ...stored, paymentStatus: 'expired' })
    } catch { return json(200, { ...result, cacheSyncPending: true }) }
    return json(200, result)
  } catch { return json(409, { message: 'Verificación o resultado incierto. No repitas; verifica el estado.' }) }
}

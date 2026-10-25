import { json } from '../lib/request'
import { getCulqiEnvironment, validateCulqiChargeId } from '../lib/culqi-verification'
import { inspectCulqiRefunds, postCulqiRefundOnce, uncertainRefund, verifiedRefundCharge } from '../lib/culqi-refunds'
import type { RefundIntent } from '../lib/culqi-refunds'
import { claimExternalRefundPost, prepareExternalRefund, recordExternalRefund } from '../lib/external-refunds'
import { getOrder, saveOrder } from '../lib/orders'

const reply = (intent: RefundIntent) => json(intent.state === 'completed' ? 200 : intent.state === 'rejected' ? 409 : 202, {
  intentId: intent.id, state: intent.state, refundId: intent.refund_id, amountInCents: Number(intent.amount_cents), currency: intent.currency,
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const finalReply = async (intent: RefundIntent): Promise<Response> => {
  if (intent.state !== 'completed') return reply(intent)
  // DB completion is atomic. Sync the existing order cache without touching items/Gift Cards.
  // A cache failure never repeats the refund POST; an explicit verify may safely retry this sync.
  try {
    const stored = await getOrder(intent.order_number)
    if (!stored || stored.checkoutId !== intent.checkout_id || stored.culqiChargeId !== intent.charge_id) throw new Error('Order cache mismatch')
    if (stored.paymentStatus !== 'refunded') await saveOrder({ ...stored, paymentStatus: 'refunded' })
    return reply(intent)
  } catch {
    return json(200, { intentId: intent.id, state: 'completed', refundId: intent.refund_id,
      amountInCents: Number(intent.amount_cents), currency: intent.currency, warning: 'refund_completed_order_cache_sync_pending' })
  }
}
const identify = async (request: Request): Promise<string | null> => {
  const auth = request.headers.get('authorization'), url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!auth?.startsWith('Bearer ') || !url || !key) return null
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: auth } })
  const user: unknown = await userResponse.json().catch(() => null)
  const id = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : ''
  if (!userResponse.ok || !uuid.test(id)) return null
  const response = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(id)}&select=role,active`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const profiles: unknown = await response.json().catch(() => null)
  return response.ok && Array.isArray(profiles) && profiles.some(p => p?.active === true && ['admin','manager'].includes(p.role)) ? id : null
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  // Checkpoint 20 is strictly staging/test. A production rollout requires separate review.
  if (getCulqiEnvironment() !== 'test' || process.env.SUPABASE_URL !== 'https://kqfphrukxdvlrbjipjnx.supabase.co') {
    return json(503, { message: 'Reembolsos habilitados solo en staging TEST.' })
  }
  let prepared: Awaited<ReturnType<typeof prepareExternalRefund>> = null
  let actor: string | null = null
  try {
    actor = await identify(request)
    if (!actor) return json(403, { message: 'Solo Admin o Manager activo puede gestionar reembolsos.' })
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { message: 'Solicitud inválida.' })
    const data = body as Record<string, unknown>
    if (Object.keys(data).some(k => !['orderId','action','note'].includes(k)) || typeof data.orderId !== 'string' || !uuid.test(data.orderId)
      || !['create','verify'].includes(String(data.action)) || typeof data.note !== 'string' || data.note.trim().length < 12 || data.note.length > 1000) {
      return json(400, { message: 'Pedido, acción y justificación son obligatorios. No envíes cargos ni importes.' })
    }
    prepared = await prepareExternalRefund(data.orderId, actor, data.note.trim(), data.action === 'create')
    if (!prepared) return json(404, { message: 'No hay intención de devolución para verificar.' })
    const intent = prepared.intent
    if (intent.state === 'completed') return finalReply(intent)
    if (!validateCulqiChargeId(intent.charge_id) || intent.currency !== 'PEN' || !Number.isSafeInteger(Number(intent.amount_cents)) || Number(intent.amount_cents) <= 0) {
      throw new Error('Invalid refund intent')
    }
    const secret = process.env.CULQI_SECRET_KEY!
    if (!await verifiedRefundCharge(secret, intent)) throw new Error('Charge evidence mismatch')
    const evidence = await inspectCulqiRefunds(secret, intent)
    if ('observation' in evidence) return finalReply(await recordExternalRefund(intent, actor, evidence.observation))
    if (!prepared.may_submit || !prepared.claim_token || data.action !== 'create'
      || !await claimExternalRefundPost(intent.order_id, intent.id, actor, prepared.claim_token)) {
      return reply(await recordExternalRefund(intent, actor, uncertainRefund(intent, 'no_refund_found_do_not_resubmit')))
    }
    const observation = await postCulqiRefundOnce(secret, intent)
    return finalReply(await recordExternalRefund(intent, actor, observation))
  } catch {
    // Includes DB failure after a provider POST. Never send another POST here.
    if (prepared && actor) {
      try { return reply(await recordExternalRefund(prepared.intent, actor, uncertainRefund(prepared.intent, 'refund_requires_verified_reconciliation'))) }
      catch { /* Persistent one-shot claim/intent survives even if observation persistence failed. */ }
    }
    return json(409, { message: 'No se pudo confirmar la devolución. No repitas el envío; consulta su estado.' })
  }
}

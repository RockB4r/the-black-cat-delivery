import type { RefundIntent, RefundObservation } from './culqi-refunds.ts'

const rpc = async <T>(name: string, body: Record<string, unknown>): Promise<T> => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Refund backend unavailable')
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Refund database HTTP ${response.status}`)
  return await response.json() as T
}
export const prepareExternalRefund = (orderId: string, actor: string, note: string, create: boolean) =>
  rpc<{ intent: RefundIntent; may_submit: boolean; claim_token?: string } | null>('prepare_external_refund', {
    p_order_id: orderId, p_actor: actor, p_note: note, p_create: create,
  })
export const claimExternalRefundPost = (orderId: string, id: string, actor: string, token: string) =>
  rpc<boolean>('claim_external_refund_post', { p_order_id: orderId, p_intent_id: id, p_actor: actor, p_claim_token: token })
export const recordExternalRefund = (intent: RefundIntent, actor: string, observation: RefundObservation) =>
  rpc<RefundIntent>('record_external_refund', { p_order_id: intent.order_id, p_intent_id: intent.id, p_actor: actor,
    p_state: observation.state, p_refund_id: observation.refundId, p_amount_cents: Number(intent.amount_cents),
    p_charge_id: intent.charge_id, p_provider_status: observation.providerStatus, p_provider_http: observation.http,
    p_safe_error: observation.safeError })

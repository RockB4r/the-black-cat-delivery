import { getCulqiEnvironment, validateCulqiChargeId } from './culqi-verification.ts'

export type RefundIntent = {
  id: string; order_id: string; checkout_id: string; order_number: string; attempt_id: string; culqi_order_id: string
  charge_id: string; amount_cents: number; currency: string; charge_since: string
  state: 'processing' | 'pending' | 'completed' | 'rejected' | 'reconciliation_required'
  refund_id: string | null; post_started_at: string | null
}
export type RefundObservation = {
  state: 'pending' | 'completed' | 'rejected' | 'reconciliation_required'
  refundId: string | null; providerStatus: string | null; http: number | null; safeError: string | null
}
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const request = (secret: string, path: string, init: RequestInit = {}) => fetch(`https://api.culqi.com/v2/${path}`, {
  ...init, headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
})
export const uncertainRefund = (intent: RefundIntent, error: string, http: number | null = null): RefundObservation => ({
  state: 'reconciliation_required', refundId: intent.refund_id, providerStatus: null, http, safeError: error,
})

export const matchingRefundCharge = (value: unknown, intent: RefundIntent): boolean => {
  const c = record(value), m = record(c?.metadata), outcome = record(c?.outcome)
  return !!c && validateCulqiChargeId(intent.charge_id) && c.id === intent.charge_id
    && Number(c.amount) === Number(intent.amount_cents) && intent.currency === 'PEN'
    && (c.currency_code === 'PEN' || c.currency === 'PEN')
    && (c.currency_code == null || c.currency_code === 'PEN') && (c.currency == null || c.currency === 'PEN')
    && c.capture === true && outcome?.type === 'venta_exitosa' && outcome.code === 'AUT0000'
    && (c.response_code == null || c.response_code === 'venta_exitosa') && (c.state == null || c.state === 'Exitosa')
    && c.description === `Pedido ${intent.order_number}` && m?.checkout_id === intent.checkout_id && m.attempt_id === intent.attempt_id
    && (m.order_id == null || m.order_id === intent.order_id || m.order_id === intent.culqi_order_id)
    && (m.order_number == null || m.order_number === intent.order_number)
    && (c.order_id == null || c.order_id === intent.culqi_order_id) && (c.order_number == null || c.order_number === intent.order_number)
  // paid is not an approval/denial oracle: successful captured Culqi charges can have paid=false.
}
export const verifiedRefundCharge = async (secret: string, intent: RefundIntent): Promise<boolean> => {
  const r = await request(secret, `charges/${encodeURIComponent(intent.charge_id)}`)
  return r.ok && matchingRefundCharge(await r.json().catch(() => null), intent)
}

export const refundObservation = (value: unknown, intent: RefundIntent, http: number): RefundObservation | null => {
  const r = record(value), environment = getCulqiEnvironment(), status = typeof r?.status === 'string' ? r.status.trim().toLowerCase() : ''
  if (!r || !environment || typeof r.id !== 'string' || !new RegExp(`^ref_${environment}_[A-Za-z0-9]+$`).test(r.id)
    || r.charge_id !== intent.charge_id || Number(r.amount) !== Number(intent.amount_cents)
    || (intent.refund_id != null && intent.refund_id !== r.id) || (r.currency_code != null && r.currency_code !== 'PEN') || (r.currency != null && r.currency !== 'PEN')
    || http < 200 || http >= 300) return null
  const state = status === 'completa' || status === 'completado' ? 'completed' : status === 'pendiente' ? 'pending' : status === 'rechazado' ? 'rejected' : null
  return state ? { state, refundId: r.id, providerStatus: String(r.status), http, safeError: null } : null
}

// Exhaust all pages. Unknown/partial/multiple refunds never authorize another POST.
export const inspectCulqiRefunds = async (secret: string, intent: RefundIntent): Promise<{ none: true } | { observation: RefundObservation }> => {
  const start = Date.parse(intent.charge_since)
  if (!Number.isFinite(start) || start > Date.now()) throw new Error('Invalid refund lookup interval')
  // Scan complete refund history, not a narrow time window that could hide an earlier refund.
  const params = new URLSearchParams({ limit: '100' })
  const seen = new Set<string>(), matches: Record<string, unknown>[] = []
  let complete = false
  for (let page = 0; page < 10; page++) {
    const response = await request(secret, `refunds?${params}`)
    const list = record(await response.json().catch(() => null))
    if (!response.ok || !list || !Array.isArray(list.data)) throw new Error('Refund list unavailable')
    for (const value of list.data) {
      const row = record(value)
      if (!row || typeof row.id !== 'string' || typeof row.charge_id !== 'string' || seen.has(row.id)) throw new Error('Invalid refund list')
      seen.add(row.id)
      if (row.charge_id === intent.charge_id) matches.push(row)
    }
    if (list.data.length < 100 && list.has_more !== true) { complete = true; break }
    const last = record(list.data.at(-1))
    if (typeof last?.id !== 'string') throw new Error('Incomplete refund list')
    params.set('after', last.id)
  }
  if (!complete) throw new Error('Incomplete refund list')
  if (matches.length > 1) throw new Error('Multiple provider refunds require manual review')
  if (intent.refund_id && matches.length === 1 && matches[0].id !== intent.refund_id) throw new Error('Conflicting refund identity')
  const id = intent.refund_id ?? (typeof matches[0]?.id === 'string' ? matches[0].id : null)
  if (!id) return { none: true }
  if (!new RegExp(`^ref_${getCulqiEnvironment()}_[A-Za-z0-9]+$`).test(id)) throw new Error('Refund environment mismatch')
  const r = await request(secret, `refunds/${encodeURIComponent(id)}`)
  const observation = refundObservation(await r.json().catch(() => null), intent, r.status)
  if (!r.ok || !observation) throw new Error('Refund evidence is incomplete or inconsistent')
  return { observation }
}

export const postCulqiRefundOnce = async (secret: string, intent: RefundIntent): Promise<RefundObservation> => {
  try {
    const r = await request(secret, 'refunds', { method: 'POST', body: JSON.stringify({
      amount: Number(intent.amount_cents), charge_id: intent.charge_id, reason: 'solicitud_comprador',
    }) })
    const value: unknown = await r.json().catch(() => null)
    if (r.ok) return refundObservation(value, intent, r.status) ?? uncertainRefund(intent, 'provider_response_incomplete', r.status)
    // A syntactically clear 4xx is recorded, but still never retried automatically.
    if ([400,401,402,403,404,422].includes(r.status) && record(value)?.object === 'error') {
      return { state: 'rejected', refundId: intent.refund_id, providerStatus: null, http: r.status, safeError: `provider_http_${r.status}` }
    }
    return uncertainRefund(intent, `provider_http_${r.status}`, r.status)
  } catch { return uncertainRefund(intent, 'provider_timeout_or_network_error') }
}

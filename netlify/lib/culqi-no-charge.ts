import { matchingCulqiOrder, validateCulqiChargeId } from './culqi-verification.ts'

type Expected = {
  id: string; orderNumber: string; amountInCents: number; checkoutId: string
  databaseOrderId: string; attemptIds: string[]; since: string
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const metadataMatches = (metadata: unknown, expected: Expected): boolean => {
  if (metadata == null) return true // Older orders/charges did not carry metadata.
  const data = record(metadata)
  return !!data && (data.checkout_id == null || data.checkout_id === expected.checkoutId)
    && (data.order_id == null || data.order_id === expected.databaseOrderId || data.order_id === expected.id)
    && (data.order_number == null || data.order_number === expected.orderNumber)
    && (data.attempt_id == null || expected.attemptIds.includes(String(data.attempt_id)))
}

// Deliberately NOT used by automatic expiry cleanup or the webhook.
export const terminalCulqiOrderForNoCharge = (value: unknown, expected: Expected): boolean => {
  const order = record(value)
  return matchingCulqiOrder(value, expected) && metadataMatches(order?.metadata, expected)
    && (order?.state === 'expired' || order?.state === 'deleted') && order?.paid !== true
  // paid_at alone is not payment evidence: it was inconsistent with a deleted order.
  // A terminal order is necessary but NOT sufficient; independently inspect charges below.
}

export const verifyCulqiNoCharge = async (secret: string, expected: Expected): Promise<boolean> => {
  const headers = { Authorization: `Bearer ${secret}` }
  const response = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(expected.id)}`, { headers })
  const order: unknown = await response.json().catch(() => null)
  if (!response.ok || !terminalCulqiOrderForNoCharge(order, expected)) return false
  const start = Date.parse(expected.since)
  if (!Number.isFinite(start) || start > Date.now()) return false
  const parameters = new URLSearchParams({ amount: String(expected.amountInCents),
    creation_date_from: String(Math.floor(start / 1000) - 300),
    creation_date_to: String(Math.ceil(Date.now() / 1000)), limit: '100' })
  const seen = new Set<string>()
  for (let page = 0; page < 10; page++) {
    const chargesResponse = await fetch(`https://api.culqi.com/v2/charges?${parameters}`, { headers })
    const list = record(await chargesResponse.json().catch(() => null))
    if (!chargesResponse.ok || !list || !Array.isArray(list.data)) return false
    for (const value of list.data) {
      const charge = record(value)
      if (!charge || !validateCulqiChargeId(charge.id) || seen.has(charge.id)) return false
      seen.add(charge.id)
      const metadata = record(charge.metadata)
      const linked = charge.description === `Pedido ${expected.orderNumber}`
        || metadata?.checkout_id === expected.checkoutId || metadata?.attempt_id != null && expected.attemptIds.includes(String(metadata.attempt_id))
        || charge.order_id === expected.id || charge.order_number === expected.orderNumber
      // An unidentifiable same-amount charge is ambiguous, not proof of no charge.
      if (!linked) {
        if (typeof charge.description !== 'string' || !charge.description.trim()) return false
        continue
      }
      if (Number(charge.amount) !== expected.amountInCents || charge.currency_code !== 'PEN'
        || (charge.currency != null && charge.currency !== 'PEN') || charge.description !== `Pedido ${expected.orderNumber}`
        || !metadataMatches(charge.metadata, expected) || (charge.order_id != null && charge.order_id !== expected.id)
        || (charge.order_number != null && charge.order_number !== expected.orderNumber)
        || charge.paid !== false || record(charge.outcome)?.type !== 'operacion_denegada'
        || (charge.response_code != null && charge.response_code !== 'operacion_denegada')
        || (charge.state != null && charge.state !== 'Rechazada')) return false
    }
    if (list.data.length < 100 && list.has_more !== true) return true
    const last = record(list.data.at(-1))
    if (!last || !validateCulqiChargeId(last.id)) return false
    parameters.set('after', last.id)
  }
  return false // Incomplete/pagination-limited evidence never releases funds.
}

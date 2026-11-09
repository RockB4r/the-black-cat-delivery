import { matchingCulqiOrder, validateCulqiChargeId } from './culqi-verification.ts'

export type PrechargeExpected = { id: string; orderNumber: string; amountInCents: number; checkoutId: string; databaseOrderId: string }
export const verifyPrechargeZeroCharges = async (secret: string, expected: PrechargeExpected) => {
  if (!secret.startsWith('sk_test_') || !expected.id.startsWith('ord_test_')) throw new Error('TEST required')
  const read = async (path: string): Promise<Record<string, unknown>> => {
    const r = await fetch(`https://api.culqi.com/v2/${path}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000) })
    const data: unknown = await r.json().catch(() => null)
    if (!r.ok || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Provider read unavailable')
    return data as Record<string, unknown>
  }
  const order = await read(`orders/${encodeURIComponent(expected.id)}`)
  if (!matchingCulqiOrder(order, expected) || order.state !== 'deleted' || order.paid === true) throw new Error('Terminal order not verified')
  const meta = order.metadata as Record<string, unknown> | null
  if (meta && (typeof meta !== 'object' || Array.isArray(meta) || meta.checkout_id != null && meta.checkout_id !== expected.checkoutId
    || meta.order_id != null && meta.order_id !== expected.databaseOrderId && meta.order_id !== expected.id
    || meta.order_number != null && meta.order_number !== expected.orderNumber)) throw new Error('Provider identity mismatch')
  const params = new URLSearchParams({ limit: '100' }), seen = new Set<string>()
  // No amount/time filter: a mismatched amount must not hide an associated charge.
  for (let page = 0; page < 10; page++) {
    const list = await read(`charges?${params}`)
    if (!Array.isArray(list.data)) throw new Error('Incomplete charge evidence')
    for (const item of list.data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid charge evidence')
      const c = item as Record<string, unknown>, m = c.metadata as Record<string, unknown> | null
      const nestedOrder = c.order && typeof c.order === 'object' ? c.order as Record<string, unknown> : null
      if (!validateCulqiChargeId(c.id) || seen.has(c.id as string)) throw new Error('Charge environment/pagination mismatch')
      seen.add(c.id as string)
      if (c.description === `Pedido ${expected.orderNumber}` || c.order_id === expected.id || c.order_id === expected.databaseOrderId || c.order_number === expected.orderNumber
        || c.order === expected.id || nestedOrder?.id === expected.id || nestedOrder?.order_number === expected.orderNumber
        || m?.checkout_id === expected.checkoutId || m?.order_id === expected.databaseOrderId || m?.order_id === expected.id
        || m?.order_number === expected.orderNumber) throw new Error('Associated charge exists')
      if (typeof c.description !== 'string' || !c.description.trim()) throw new Error('Unidentifiable charge')
    }
    if (list.data.length < 100 && list.has_more !== true) return { order_id: expected.id, order_number: expected.orderNumber,
      amount: expected.amountInCents, currency: 'PEN', state: 'deleted', order_http: 200, associated_charges: 0,
      approved_charges: 0, charge_scan_complete: true, checked_at: new Date().toISOString() }
    const last = list.data.at(-1) as Record<string, unknown> | undefined
    if (!last || !validateCulqiChargeId(last.id)) throw new Error('Incomplete pagination')
    params.set('after', last.id as string)
  }
  throw new Error('Incomplete charge scan')
}

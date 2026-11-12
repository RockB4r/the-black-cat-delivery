import { evaluateReconciledChargeResponse, getCulqiEnvironment, matchingCulqiOrder, validateCulqiChargeId } from './culqi-verification.ts'

export type AuthorizedExpected = {
  orderId: string; orderNumber: string; checkoutId: string; attemptId: string; chargeId: string; culqiOrderId: string
}
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

// Recovery for the known classification bug only. No provider POST/DELETE, no retry.
export const verifyExternallyAuthorizedCharge = async (secret: string, e: AuthorizedExpected) => {
  if (getCulqiEnvironment(secret) !== 'test' || !validateCulqiChargeId(e.chargeId, 'test')) throw Error('TEST only')
  const read = async (path: string) => {
    const response = await fetch(`https://api.culqi.com/v2/${path}`, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000) })
    const value = record(await response.json().catch(() => null))
    if (response.status !== 200 || !value) throw Error('Provider evidence unavailable')
    return value
  }
  const expected = { id: e.chargeId, amountInCents: 1000, description: `Pedido ${e.orderNumber}`, checkoutId: e.checkoutId, attemptId: e.attemptId }
  const strictCharge = (c: Record<string, unknown>) => {
    const m = record(c.metadata), outcome = record(c.outcome)
    return evaluateReconciledChargeResponse(c, expected, 200) === 'approved'
      && c.currency_code === 'PEN' && c.capture === true && outcome?.type === 'venta_exitosa' && outcome.code === 'AUT0000'
      && typeof c.authorization_code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.authorization_code)
      && c.decline_code == null && m?.checkout_id === e.checkoutId && m.attempt_id === e.attemptId
      && (m.order_id == null || m.order_id === e.orderId || m.order_id === e.culqiOrderId)
      && (m.order_number == null || m.order_number === e.orderNumber)
      && (c.order_id == null || c.order_id === e.culqiOrderId)
      && (c.order_number == null || c.order_number === e.orderNumber)
  }
  const charge = await read(`charges/${encodeURIComponent(e.chargeId)}`)
  if (!strictCharge(charge)) throw Error('Captured authorization not verified')
  const order = await read(`orders/${encodeURIComponent(e.culqiOrderId)}`)
  if (!matchingCulqiOrder(order, { id: e.culqiOrderId, orderNumber: e.orderNumber, amountInCents: 1000 })
    || !['pending', 'paid'].includes(String(order.state))) throw Error('Order identity/state mismatch')
  const om = record(order.metadata)
  if (order.metadata != null && !om || om && (om.checkout_id != null && om.checkout_id !== e.checkoutId
    || om.order_id != null && om.order_id !== e.orderId && om.order_id !== e.culqiOrderId
    || om.order_number != null && om.order_number !== e.orderNumber)) throw Error('Order metadata mismatch')
  const all = async (resource: 'charges' | 'refunds') => {
    const params = new URLSearchParams({ limit: '100' }), seen = new Set<string>(), rows: Record<string, unknown>[] = []
    // No time/amount filter: a second charge with wrong amount must not disappear from the evidence.
    for (let page = 0; page < 10; page++) {
      const list = await read(`${resource}?${params}`)
      if (!Array.isArray(list.data) || list.data.length > 100 || list.has_more != null && typeof list.has_more !== 'boolean') throw Error('Incomplete provider list')
      for (const value of list.data) {
        const row = record(value)
        if (!row || typeof row.id !== 'string' || seen.has(row.id)
          || !(resource === 'charges' ? /^chr_test_[A-Za-z0-9]+$/ : /^ref_test_[A-Za-z0-9]+$/).test(row.id)) throw Error('Provider pagination mismatch')
        seen.add(row.id); rows.push(row)
      }
      if (list.data.length < 100 && list.has_more !== true) return rows
      const last = rows.at(-1)
      if (!last || !list.data.length) throw Error('Incomplete provider scan')
      params.set('after', String(last.id))
    }
    throw Error('Provider scan limit reached')
  }
  const charges = await all('charges'), associated: Record<string, unknown>[] = []
  for (const c of charges) {
    const m = record(c.metadata), nested = record(c.order)
    if (c.id === e.chargeId || c.description === expected.description || c.order_id === e.culqiOrderId || c.order_id === e.orderId
      || c.order_number === e.orderNumber || c.order === e.culqiOrderId || nested?.id === e.culqiOrderId || nested?.order_number === e.orderNumber
      || m?.checkout_id === e.checkoutId || m?.attempt_id === e.attemptId || m?.order_id === e.orderId || m?.order_id === e.culqiOrderId || m?.order_number === e.orderNumber) associated.push(c)
    else if (!c.description || typeof c.description !== 'string' || !c.description.trim()) throw Error('Unidentifiable charge')
  }
  if (associated.length !== 1 || associated[0].id !== e.chargeId || !strictCharge(associated[0])) throw Error('Single authorized charge not verified')
  for (const r of await all('refunds')) {
    if (typeof r.charge_id !== 'string') throw Error('Unidentifiable refund')
    if (r.charge_id === e.chargeId) throw Error('Refund exists')
  }
  // Persist a bounded attestation, never provider payload, authorization code, source, fingerprint, or credentials.
  return { charge_id: e.chargeId, order_id: e.culqiOrderId, order_number: e.orderNumber, checkout_id: e.checkoutId, attempt_id: e.attemptId,
    amount: 1000, currency: 'PEN', capture: true, outcome_type: 'venta_exitosa', outcome_code: 'AUT0000', authorization_present: true,
    decline_absent: true, classification: 'approved', associated_charges: 1, approved_charges: 1, refunds: 0,
    charge_scan_complete: true, refund_scan_complete: true, charge_http: 200, checked_at: new Date().toISOString() }
}

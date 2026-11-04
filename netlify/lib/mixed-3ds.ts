import { createHash } from 'node:crypto'
import { evaluateOriginalChargeResponse, validateCulqiChargeId, type ChargeExpectation } from './culqi-verification.ts'

export const mixed3DSContextHash = (value: { checkoutId: string; orderId: string; token: string; fingerprint: string; amount: number; currency: string }) =>
  createHash('sha256').update(JSON.stringify([value.checkoutId, value.orderId, value.token, value.fingerprint, value.amount, value.currency])).digest('hex')
export const continuationHash = (token: string) => createHash('sha256').update(token).digest('hex')

export const classifyMixedCharge = (value: unknown, expected: ChargeExpectation, http: number): 'approved' | 'authentication_required' | 'rejected' | 'ambiguous' => {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  // Official Culqi demo uses explicit REVIEW. HTTP alone and free-text merchant messages are not sufficient.
  if (http >= 200 && http < 300 && body?.action_code === 'REVIEW' && (body.paid == null || body.paid === false)
    && body.response_code == null && body.state == null) {
    const meta = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : null
    const outcome = body.outcome && typeof body.outcome === 'object' ? body.outcome as Record<string, unknown> : null
    if ((body.id != null && !validateCulqiChargeId(body.id))
      || (body.amount != null && Number(body.amount) !== expected.amountInCents)
      || (body.currency_code != null && body.currency_code !== 'PEN') || (body.currency != null && body.currency !== 'PEN')
      || (body.description != null && body.description !== expected.description)
      || (meta?.checkout_id != null && meta.checkout_id !== expected.checkoutId)
      || (meta?.attempt_id != null && meta.attempt_id !== expected.attemptId)
      || outcome?.type === 'venta_exitosa') return 'ambiguous'
    return 'authentication_required'
  }
  const evidence = evaluateOriginalChargeResponse(body, expected, http)
  if (evidence === 'approved') return 'approved'
  if (evidence === 'failed') return 'rejected'
  // Decline only if provider supplied an explicit error. Unknown/malformed 4xx remains uncertain.
  if (http >= 400 && http < 500 && body?.object === 'error' && body.type === 'card_error') return 'rejected'
  return 'ambiguous'
}

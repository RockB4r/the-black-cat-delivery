type CulqiRecord = Record<string, unknown>

export type CulqiEnvironment = 'test' | 'live'
export const getCulqiEnvironment = (key: string | undefined = process.env.CULQI_SECRET_KEY): CulqiEnvironment | null => {
  const match = /^(?:sk)_(test|live)_[A-Za-z0-9]+$/.exec(key ?? '')
  return match ? match[1] as CulqiEnvironment : null
}
export const validateCulqiChargeId = (id: unknown, environment = getCulqiEnvironment()): id is string =>
  environment !== null && typeof id === 'string' && new RegExp(`^chr_${environment}_[A-Za-z0-9]+$`).test(id)
export const validateCulqiOrderId = (id: unknown, environment = getCulqiEnvironment()): id is string =>
  environment !== null && typeof id === 'string' && new RegExp(`^ord_${environment}_[A-Za-z0-9]+$`).test(id)

export const culqiGiftCardOrderNumber = (checkoutId: string): string => `GC-${checkoutId.replaceAll('-', '')}`

export const validateCulqiReferences = (orderId: string | null | undefined, chargeId: string | null | undefined): boolean =>
  getCulqiEnvironment() !== null && (!orderId || validateCulqiOrderId(orderId)) && (!chargeId || validateCulqiChargeId(chargeId))

export const sanitizeCulqiErrorBody = (body: string): string => {
  const sanitized = body
    .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+\b/gi, '[REDACTED_KEY]')
    .replace(/\bBearer\s+[^\s"}]+/gi, 'Bearer [REDACTED]')
    .replace(/("(?:first_name|last_name|email|phone_number|name|phone|address|token|authorization)"\s*:\s*")[^"]*/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b\+?\d(?:[\s().-]*\d){8,}\b/g, '[REDACTED_NUMBER]')
  return sanitized.slice(0, 600) || '[empty body]'
}

const record = (value: unknown): CulqiRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as CulqiRecord : null

const cents = (value: unknown): number | null => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export const matchingCulqiOrder = (value: unknown, expected: {
  id: string; orderNumber: string; amountInCents: number
}): boolean => {
  const order = record(value)
  return !!order
    && validateCulqiOrderId(expected.id)
    && order.id === expected.id
    && order.order_number === expected.orderNumber
    && cents(order.amount) === expected.amountInCents
    && order.currency_code === 'PEN'
}

export const confirmedCulqiOrder = (value: unknown, expected: {
  id: string; orderNumber: string; amountInCents: number
}): boolean => matchingCulqiOrder(value, expected) && record(value)?.state === 'paid'

export const expiredCulqiOrder = (value: unknown, expected: {
  id: string; orderNumber: string; amountInCents: number
}): boolean => {
  return matchingCulqiOrder(value, expected) && record(value)?.state === 'expired'
}

export type ChargeExpectation = { amountInCents: number; description: string; id: string; checkoutId?: string; attemptId?: string }
export type ChargeEvidence = 'approved' | 'failed' | 'ambiguous' | 'invalid'
const evaluateCharge = (value: unknown, expected: ChargeExpectation, httpStatus: number): ChargeEvidence => {
  const charge = record(value)
  if (!charge) return 'invalid'
  const outcome = record(charge.outcome)
  const successCode = (v: unknown) => v === 'venta_exitosa' || v === 'AUT0000'
  const deniedCode = (v: unknown) => typeof v === 'string' && (['denegada', 'operacion_denegada'].includes(v) || /^DNG[AE]\d{4}$/.test(v))
  const positive = outcome?.type === 'venta_exitosa' || outcome?.code === 'AUT0000'
    || successCode(charge.response_code) || charge.state === 'Exitosa'
  const negative = outcome?.type === 'operacion_denegada' || deniedCode(outcome?.code) || deniedCode(charge.response_code)
    || ['Rechazada', 'Rechazado'].includes(String(charge.state)) || ['Rechazada', 'Rechazado'].includes(String(charge.status))
    || ['DENY', 'DECLINE', 'REJECT'].includes(String(charge.action_code))
    || typeof charge.decline_code === 'string' && charge.decline_code.trim().length > 0
  const metadata = record(charge?.metadata)
  const currency = charge?.currency
  const currencyCode = charge?.currency_code
  const matches = !!charge
    && validateCulqiChargeId(charge.id)
    && charge.id === expected.id
    && cents(charge.amount) === expected.amountInCents
    && (currency === 'PEN' || currencyCode === 'PEN')
    && (currency == null || currency === 'PEN')
    && (currencyCode == null || currencyCode === 'PEN')
    && charge.description === expected.description
    && (metadata?.checkout_id == null || metadata.checkout_id === expected.checkoutId)
    && (!expected.attemptId || metadata?.attempt_id == null || metadata.attempt_id === expected.attemptId)
  // A positive provider decision with a financial/context/HTTP conflict requires reconciliation.
  if (!matches || httpStatus < 200 || httpStatus >= 300) return positive ? 'ambiguous' : 'invalid'
  if ([charge.paid, charge.capture, charge.captured].some(v => v != null && typeof v !== 'boolean')
    || charge.decline_code != null && typeof charge.decline_code !== 'string'
    || charge.outcome != null && !outcome || charge.metadata != null && !metadata) return 'ambiguous'
  if (positive && negative) return 'ambiguous'
  if (negative) return 'failed'
  const unknownSignal = outcome?.type != null && outcome.type !== 'venta_exitosa'
    || outcome?.code != null && outcome.code !== 'AUT0000'
    || charge.response_code != null && !successCode(charge.response_code)
    || charge.action_code != null && charge.action_code !== 'APPROVE'
    || charge.state != null && charge.state !== 'Exitosa'
    || charge.status != null && charge.status !== 'Exitosa'
  if (unknownSignal || charge.capture === false || charge.captured === false) return 'ambiguous'
  const authorizedCaptured = outcome?.type === 'venta_exitosa' && outcome.code === 'AUT0000'
    && currencyCode === 'PEN' && charge.capture === true && typeof charge.authorization_code === 'string'
    && /^[A-Za-z0-9_-]{1,64}$/.test(charge.authorization_code)
    && (!expected.checkoutId || metadata?.checkout_id === expected.checkoutId)
    && (!expected.attemptId || metadata?.attempt_id === expected.attemptId)
  // paid is not the authorization verdict. The paid=false shape needs the full captured authorization contract.
  if (charge.paid === false) return authorizedCaptured ? 'approved' : 'ambiguous'
  // Preserve previously supported explicit success shapes; neither paid=true nor HTTP alone can approve.
  if (authorizedCaptured || charge.response_code === 'venta_exitosa' || charge.state === 'Exitosa'
    || outcome?.type === 'venta_exitosa') return 'approved'
  return 'ambiguous'
}

export const evaluateOriginalChargeResponse = (value: unknown, expected: ChargeExpectation, httpStatus: number): ChargeEvidence =>
  evaluateCharge(value, expected, httpStatus)
export const evaluateReconciledChargeResponse = (value: unknown, expected: ChargeExpectation, httpStatus: number): ChargeEvidence =>
  evaluateCharge(value, expected, httpStatus)
export const confirmedCulqiCharge = (value: unknown, expected: ChargeExpectation): boolean =>
  evaluateReconciledChargeResponse(value, expected, 200) === 'approved'

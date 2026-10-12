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

type ChargeExpectation = { amountInCents: number; description: string; id: string; checkoutId?: string }
export type ChargeEvidence = 'approved' | 'failed' | 'ambiguous' | 'invalid'
const evaluateCharge = (value: unknown, expected: ChargeExpectation, context: 'ORIGINAL_POST' | 'LATER_GET', httpStatus: number): ChargeEvidence => {
  const charge = record(value)
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
  if (!matches || httpStatus < 200 || httpStatus >= 300) return 'invalid'
  if ((charge.response_code != null && charge.response_code !== 'venta_exitosa')
    || (charge.state != null && charge.state !== 'Exitosa')) return 'failed'
  if (charge.response_code === 'venta_exitosa' || charge.state === 'Exitosa') return 'approved'
  return context === 'ORIGINAL_POST' && httpStatus === 201 ? 'approved' : 'ambiguous'
}

export const evaluateOriginalChargeResponse = (value: unknown, expected: ChargeExpectation, httpStatus: number): ChargeEvidence =>
  evaluateCharge(value, expected, 'ORIGINAL_POST', httpStatus)
export const evaluateReconciledChargeResponse = (value: unknown, expected: ChargeExpectation, httpStatus: number): ChargeEvidence =>
  evaluateCharge(value, expected, 'LATER_GET', httpStatus)
export const confirmedCulqiCharge = (value: unknown, expected: ChargeExpectation): boolean =>
  evaluateReconciledChargeResponse(value, expected, 200) === 'approved'

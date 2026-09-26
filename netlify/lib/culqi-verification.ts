type CulqiRecord = Record<string, unknown>

export const culqiGiftCardOrderNumber = (checkoutId: string): string => `GC-${checkoutId.replaceAll('-', '')}`

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

export const confirmedCulqiCharge = (value: unknown, expected: {
  amountInCents: number; description: string; id: string; checkoutId?: string; allowMissingStatus?: boolean
}): boolean => {
  const charge = record(value)
  const metadata = record(charge?.metadata)
  const currency = charge?.currency
  const currencyCode = charge?.currency_code
  return !!charge
    && typeof charge.id === 'string'
    && charge.id.startsWith('chr_')
    && charge.id === expected.id
    && (charge.response_code === 'venta_exitosa' || (charge.response_code == null && expected.allowMissingStatus === true))
    && (charge.state == null || charge.state === 'Exitosa')
    && cents(charge.amount) === expected.amountInCents
    && (currency === 'PEN' || currencyCode === 'PEN')
    && (currency == null || currency === 'PEN')
    && (currencyCode == null || currencyCode === 'PEN')
    && charge.description === expected.description
    && (metadata?.checkout_id == null || metadata.checkout_id === expected.checkoutId)
}

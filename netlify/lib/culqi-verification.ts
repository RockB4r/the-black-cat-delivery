type CulqiRecord = Record<string, unknown>

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
  amountInCents: number; description: string; id?: string
}): boolean => {
  const charge = record(value)
  return !!charge
    && typeof charge.id === 'string'
    && charge.id.startsWith('chr_')
    && (!expected.id || charge.id === expected.id)
    && charge.response_code === 'venta_exitosa'
    && cents(charge.amount) === expected.amountInCents
    && (charge.currency === 'PEN' || charge.currency_code === 'PEN')
    && (charge.description === expected.description || charge.description === null)
}

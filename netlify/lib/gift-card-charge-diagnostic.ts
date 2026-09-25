import { confirmedCulqiCharge } from './culqi-verification.ts'

export const diagnosticChargeId = 'chr_test_KZ1Gsu01muNpi1Ns'

type ExpectedPurchase = { checkout_id: string; amount: number } | null
type RecordValue = Record<string, unknown>

const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null

const safeString = (value: unknown, pattern: RegExp): string | null =>
  typeof value === 'string' && pattern.test(value) ? value : null

const cents = (value: unknown): number | null => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

const safeMetadata = (value: unknown) => {
  const metadata = record(value)
  if (!metadata) return null
  return {
    checkout_id: safeString(metadata.checkout_id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i),
    order_id: safeString(metadata.order_id, /^ord_test_[A-Za-z0-9_-]{1,64}$/),
    order_number: safeString(metadata.order_number, /^GC-[0-9a-f]{32}$/i),
  }
}

export const checkoutIdFromDiagnosticCharge = (value: unknown): string | null => {
  const description = record(value)?.description
  return typeof description === 'string'
    ? description.match(/^Gift Card ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)?.[1] ?? null
    : null
}

export const buildGiftChargeDiagnostic = (value: unknown, purchase: ExpectedPurchase) => {
  const charge = record(value)
  const expectedAmount = purchase ? Math.round(Number(purchase.amount) * 100) : null
  const expectedDescription = purchase ? `Gift Card ${purchase.checkout_id}` : null
  const checks = {
    id: charge?.id === diagnosticChargeId,
    amount: expectedAmount !== null && cents(charge?.amount) === expectedAmount,
    currency: charge?.currency === 'PEN' || charge?.currency_code === 'PEN',
    response_code: charge?.response_code === 'venta_exitosa',
    description: expectedDescription !== null && (charge?.description === expectedDescription || charge?.description === null),
  }
  const confirmed = purchase !== null && confirmedCulqiCharge(charge, {
    id: diagnosticChargeId, amountInCents: expectedAmount!, description: expectedDescription!,
  })
  if (confirmed !== Object.values(checks).every(Boolean)) throw new Error('Charge diagnostic checks differ from confirmedCulqiCharge')

  return {
    id: safeString(charge?.id, /^chr_test_[A-Za-z0-9_-]{1,64}$/),
    amount: cents(charge?.amount),
    currency: safeString(charge?.currency, /^[A-Z]{3}$/),
    currency_code: safeString(charge?.currency_code, /^[A-Z]{3}$/),
    response_code: safeString(charge?.response_code, /^[A-Za-z0-9_-]{1,64}$/),
    state: safeString(charge?.state, /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ _-]{1,64}$/),
    description: safeString(charge?.description, /^Gift Card [0-9a-f-]{36}$/i),
    order_id: safeString(charge?.order_id, /^ord_test_[A-Za-z0-9_-]{1,64}$/),
    order_number: safeString(charge?.order_number, /^GC-[0-9a-f]{32}$/i),
    reference_code: safeString(charge?.reference_code, /^[A-Za-z0-9_-]{1,64}$/),
    metadata: safeMetadata(charge?.metadata),
    checks,
  }
}

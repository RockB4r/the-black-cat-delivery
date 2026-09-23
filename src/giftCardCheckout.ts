export type GiftPurchaseForm = {
  amountChoice: string
  customAmount: string
  purchaserName: string
  purchaserEmail: string
  purchaserPhone: string
  recipientName: string
  recipientEmail: string
  recipientPhone: string
  message: string
  transferable: boolean
  deliveryMethod: 'email' | 'whatsapp' | 'personal'
}

export type GiftCheckoutIntent = { checkoutId: string; form: GiftPurchaseForm; submitted: boolean }
export const giftCheckoutStorageKey = 'tbc-gift-checkout'

export const emptyGiftPurchaseForm = (): GiftPurchaseForm => ({
  amountChoice: '50', customAmount: '', purchaserName: '', purchaserEmail: '', purchaserPhone: '',
  recipientName: '', recipientEmail: '', recipientPhone: '', message: '',
  transferable: true, deliveryMethod: 'personal',
})

const checkoutIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stringFields = ['amountChoice', 'customAmount', 'purchaserName', 'purchaserEmail', 'purchaserPhone', 'recipientName', 'recipientEmail', 'recipientPhone', 'message'] as const
const isGiftPurchaseForm = (value: unknown): value is GiftPurchaseForm => {
  if (!value || typeof value !== 'object') return false
  const form = value as Record<string, unknown>
  return stringFields.every((field) => typeof form[field] === 'string')
    && typeof form.transferable === 'boolean'
    && (form.deliveryMethod === 'email' || form.deliveryMethod === 'whatsapp' || form.deliveryMethod === 'personal')
}

export const newGiftCheckout = (makeId = () => crypto.randomUUID()): GiftCheckoutIntent => ({
  checkoutId: makeId(), form: emptyGiftPurchaseForm(), submitted: false,
})

export const restoreGiftCheckout = (saved: string | null, makeId = () => crypto.randomUUID()): GiftCheckoutIntent => {
  try {
    const value: unknown = saved ? JSON.parse(saved) : null
    if (value && typeof value === 'object') {
      const intent = value as Record<string, unknown>
      if (typeof intent.checkoutId === 'string' && checkoutIdPattern.test(intent.checkoutId)
        && isGiftPurchaseForm(intent.form) && typeof intent.submitted === 'boolean') {
        return { checkoutId: intent.checkoutId, form: intent.form, submitted: intent.submitted }
      }
    }
  } catch { /* Legacy checkout IDs or unavailable snapshots start a fresh purchase. */ }
  return newGiftCheckout(makeId)
}

const optional = (value: string, max: number) => value.trim().slice(0, max) || null
const comparableForm = (form: GiftPurchaseForm) => JSON.stringify({
  amount: form.amountChoice === 'custom' ? Number(form.customAmount) : Number(form.amountChoice),
  purchaserName: optional(form.purchaserName, 160), purchaserEmail: optional(form.purchaserEmail, 254),
  purchaserPhone: optional(form.purchaserPhone, 40), recipientName: optional(form.recipientName, 160),
  recipientEmail: optional(form.recipientEmail, 254), recipientPhone: optional(form.recipientPhone, 40),
  message: optional(form.message, 1000), transferable: form.transferable, deliveryMethod: form.deliveryMethod,
})

export const checkoutForGiftPurchase = (current: GiftCheckoutIntent, form: GiftPurchaseForm, makeId = () => crypto.randomUUID()): GiftCheckoutIntent => ({
  checkoutId: current.submitted && comparableForm(current.form) !== comparableForm(form) ? makeId() : current.checkoutId,
  form: { ...form }, submitted: true,
})

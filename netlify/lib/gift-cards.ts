import { getStore } from '@netlify/blobs'
import { confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder } from './culqi-verification.ts'

export type GiftDelivery = 'email' | 'whatsapp' | 'personal'
export type GiftPurchaseInput = {
  checkoutId: string
  amount: number
  purchaserName: string
  purchaserEmail: string
  purchaserPhone: string | null
  recipientName: string | null
  recipientEmail: string | null
  recipientPhone: string | null
  message: string | null
  transferable: boolean
  deliveryMethod: GiftDelivery
}
export type GiftPurchase = {
  checkout_id: string
  access_token: string
  amount: number
  purchaser_name: string
  purchaser_email: string
  purchaser_phone: string | null
  recipient_name: string | null
  recipient_email: string | null
  recipient_phone: string | null
  gift_message: string | null
  transferable: boolean
  delivery_method: GiftDelivery
  payment_status: 'pending' | 'paid' | 'expired'
  culqi_order_id: string | null
  culqi_charge_id: string | null
  card_id: string | null
  created_at: string
}
export type GiftReceipt = {
  code: string
  token: string
  payment_code: string
  amount: number
  activated_at: string
  expires_at: string
  purchaser_name: string
  recipient_name: string | null
  payment_method: 'culqi'
}
export const giftCardDeliveryDraft = (purchase: GiftPurchase, receipt: GiftReceipt, origin: string) => {
  const link = `${origin.replace(/\/$/, '')}/gift/${receipt.token}`
  const taxNote = 'El comprobante de pago se emitirá cuando esta Gift Card sea utilizada para adquirir productos o consumos en The Black Cat.'
  const subject = 'Tu Gift Card de The Black Cat – Rock Bar'
  const content = `${purchase.recipient_name ? `Hola ${purchase.recipient_name},` : '¡Hola!'}\n${purchase.purchaser_name} te regaló una Gift Card por S/ ${Number(receipt.amount).toFixed(2)}.\nCódigo: ${receipt.code}\nVálida hasta: ${receipt.expires_at.slice(0, 10)}\n${purchase.gift_message ? `${purchase.gift_message}\n` : ''}Verla aquí: ${link}\n${taxNote}`
  return { subject, content, recipientEmail: purchase.recipient_email, recipientPhone: purchase.recipient_phone, deliveryMethod: purchase.delivery_method, link, taxNote }
}
export type OrderGiftPayment = { checkout_id: string; order_id: string; gift_card_id: string; gift_amount: number; other_amount: number; status: 'reserved' | 'applied' | 'released' | 'refunded'; payment_state: 'pending' | 'payment_pending' | 'reconciliation_required' | 'paid' | 'failed' | 'expired' | 'released' | 'applied'; reserved_at: string; expires_at: string; culqi_reference: string | null }

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const digits = (value: string) => value.replace(/\D/g, '')
const optional = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

export const parseGiftPurchase = (body: unknown): GiftPurchaseInput | null => {
  if (!body || typeof body !== 'object') return null
  const data = body as Record<string, unknown>
  const checkoutId = typeof data.checkoutId === 'string' ? data.checkoutId.trim() : ''
  const amountChoice = data.amountChoice
  const customAmount = data.customAmount
  const amount = amountChoice === 'custom' ? Number(customAmount) : Number(amountChoice)
  const purchaserName = optional(data.purchaserName, 160) ?? ''
  const purchaserEmail = optional(data.purchaserEmail, 254) ?? ''
  const purchaserPhone = optional(data.purchaserPhone, 40)
  const recipientName = optional(data.recipientName, 160)
  const recipientEmail = optional(data.recipientEmail, 254)
  const recipientPhone = optional(data.recipientPhone, 40)
  const message = optional(data.message, 1000)
  const transferable = data.transferable === true
  const deliveryMethod = data.deliveryMethod
  if (!uuidPattern.test(checkoutId) || !Number.isFinite(amount) || !Number.isSafeInteger(amount * 100) || amount > 999999
    || !(amountChoice === 'custom' ? amount > 100 : [50, 75, 100, 200].includes(amount) && String(amountChoice) === String(amount))
    || !purchaserName || !emailPattern.test(purchaserEmail) || (recipientEmail && !emailPattern.test(recipientEmail))
    || (purchaserPhone && digits(purchaserPhone).length < 9) || (recipientPhone && digits(recipientPhone).length < 9)
    || (deliveryMethod !== 'email' && deliveryMethod !== 'whatsapp' && deliveryMethod !== 'personal')
    || (deliveryMethod === 'email' && !recipientEmail) || (deliveryMethod === 'whatsapp' && !recipientPhone)
    || (!transferable && !recipientName)) return null
  return { checkoutId, amount, purchaserName, purchaserEmail, purchaserPhone, recipientName, recipientEmail, recipientPhone, message, transferable, deliveryMethod }
}

const databaseConfig = () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server configuration is incomplete')
  return { url, key }
}

const database = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const { url, key } = databaseConfig()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  })
  if (!response.ok) throw new Error(`Gift Card database request failed with HTTP ${response.status}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

const one = <T>(rows: T[]) => rows[0] ?? null

export const giftPurchaseLock = () => getStore({ name: 'the-black-cat-gift-purchase-locks', consistency: 'strong' })
export const giftChargeLock = () => getStore({ name: 'the-black-cat-gift-charge-locks', consistency: 'strong' })

export const getGiftPurchase = async (checkoutId: string) => one(await database<GiftPurchase[]>(`gift_card_purchases?checkout_id=eq.${encodeURIComponent(checkoutId)}&select=*`))
export const getGiftPurchaseByAccess = async (accessToken: string) => one(await database<GiftPurchase[]>(`gift_card_purchases?access_token=eq.${encodeURIComponent(accessToken)}&select=*`))
export const getGiftPurchaseByCulqiOrder = async (culqiOrderId: string) => one(await database<GiftPurchase[]>(`gift_card_purchases?culqi_order_id=eq.${encodeURIComponent(culqiOrderId)}&select=*`))

export const createGiftPurchase = async (input: GiftPurchaseInput) => {
  await database<GiftPurchase[]>('gift_card_purchases?on_conflict=checkout_id', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      checkout_id: input.checkoutId, amount: input.amount, purchaser_name: input.purchaserName,
      purchaser_email: input.purchaserEmail, purchaser_phone: input.purchaserPhone,
      recipient_name: input.recipientName, recipient_email: input.recipientEmail,
      recipient_phone: input.recipientPhone, gift_message: input.message,
      transferable: input.transferable, delivery_method: input.deliveryMethod,
    }),
  })
  const purchase = await getGiftPurchase(input.checkoutId)
  if (!purchase || purchase.amount !== input.amount || purchase.purchaser_email !== input.purchaserEmail
    || purchase.purchaser_name !== input.purchaserName || purchase.delivery_method !== input.deliveryMethod
    || purchase.purchaser_phone !== input.purchaserPhone || purchase.recipient_name !== input.recipientName
    || purchase.recipient_email !== input.recipientEmail || purchase.recipient_phone !== input.recipientPhone
    || purchase.gift_message !== input.message || purchase.transferable !== input.transferable) throw new Error('Gift purchase checkout conflict')
  return purchase
}

export const attachGiftCulqiOrder = async (checkoutId: string, culqiOrderId: string) => {
  const rows = await database<GiftPurchase[]>(`gift_card_purchases?checkout_id=eq.${encodeURIComponent(checkoutId)}&culqi_order_id=is.null&payment_status=eq.pending&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ culqi_order_id: culqiOrderId }),
  })
  if (!rows.length) throw new Error('Gift purchase could not be linked to Culqi order')
  return rows[0]
}

export const recordGiftCharge = async (checkoutId: string, chargeId: string) => {
  const rows = await database<GiftPurchase[]>(`gift_card_purchases?checkout_id=eq.${encodeURIComponent(checkoutId)}&culqi_charge_id=is.null&payment_status=eq.pending&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ culqi_charge_id: chargeId }),
  })
  if (rows.length !== 1) throw new Error('Gift Card charge could not be linked to purchase')
}

export const finalizeGiftPurchase = async (purchase: GiftPurchase, chargeId: string | null = null) => {
  const receipt = await database<GiftReceipt>('rpc/finalize_gift_card_purchase', {
    method: 'POST', body: JSON.stringify({ p_checkout_id: purchase.checkout_id, p_culqi_order_id: purchase.culqi_order_id, p_culqi_charge_id: chargeId }),
  })
  return receipt
}

export const publicGiftCard = async (token: string) => one(await database<Array<{
  code: string; online_payment_code: string; qr_token: string; initial_balance: number; current_balance: number; status: string;
  purchaser_name: string; recipient_name: string | null; gift_message: string | null; expires_at: string | null; activated_at: string | null
}>>(`gift_cards?qr_token=eq.${encodeURIComponent(token)}&select=code,online_payment_code,qr_token,initial_balance,current_balance,status,purchaser_name,recipient_name,gift_message,expires_at,activated_at`))

type PaymentCard = { id: string; current_balance: number; status: string; expires_at: string; transferable: boolean; recipient_name: string | null }
const cardByPaymentCode = (paymentCode: string) =>
  database<PaymentCard[]>(`gift_cards?online_payment_code=eq.${encodeURIComponent(paymentCode)}&select=id,current_balance,status,expires_at,transferable,recipient_name`).then(one)

// An expired mixed reservation is reconciled against Culqi before releasing it.
// No cron is required: quote and reserve requests trigger reconciliation.
export const reconcileExpiredGiftReservations = async (cardId: string) => {
  const { getOrder, saveOrder } = await import('./orders')
  const rows = await database<OrderGiftPayment[]>(`gift_card_order_payments?gift_card_id=eq.${encodeURIComponent(cardId)}&status=eq.reserved&expires_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*`)
  for (const payment of rows) {
    const order = one(await database<Array<{ id: string; order_number: string; culqi_order_id: string | null; culqi_charge_id: string | null; payment_status: string }>>(`orders?id=eq.${encodeURIComponent(payment.order_id)}&select=id,order_number,culqi_order_id,culqi_charge_id,payment_status`))
    if (!order) throw new Error('Expired Gift Card reservation has no order')
    if (payment.other_amount === 0 || (!order.culqi_order_id && !order.culqi_charge_id)) {
      await setGiftPaymentState(payment.order_id, 'expired')
      await releaseGiftReservation(payment.order_id)
      continue
    }
    const key = process.env.CULQI_SECRET_KEY
    if (!key) throw new Error('Culqi reconciliation key is unavailable')
    if (order.culqi_charge_id) {
      const chargeResponse = await fetch(`https://api.culqi.com/v2/charges/${encodeURIComponent(order.culqi_charge_id)}`, { headers: { Authorization: `Bearer ${key}` } })
      const charge: unknown = await chargeResponse.json().catch(() => null)
      if (!chargeResponse.ok) throw new Error('Culqi charge reconciliation is unavailable')
      if (confirmedCulqiCharge(charge, { id: order.culqi_charge_id, amountInCents: Math.round(Number(payment.other_amount) * 100), description: `Pedido ${order.order_number}` })) {
        await setGiftPaymentState(payment.order_id, 'paid')
        await applyGiftToOrder(payment.order_id, order.culqi_charge_id)
        const stored = await getOrder(order.order_number)
        if (stored) await saveOrder({ ...stored, paymentStatus: 'paid', paymentMethod: 'gift_card_culqi', culqiChargeId: order.culqi_charge_id, giftCardAmount: payment.gift_amount, otherPaymentAmount: payment.other_amount, otherPaymentMethod: 'culqi' })
      }
      else await setGiftPaymentState(payment.order_id, 'reconciliation_required')
      continue
    }
    if (!order.culqi_order_id) continue
    const response = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(order.culqi_order_id)}`, { headers: { Authorization: `Bearer ${key}` } })
    const culqiOrder: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new Error('Culqi reconciliation is unavailable')
    const expected = { id: order.culqi_order_id, orderNumber: order.order_number, amountInCents: Math.round(Number(payment.other_amount) * 100) }
    if (confirmedCulqiOrder(culqiOrder, expected)) {
      await setGiftPaymentState(payment.order_id, 'paid')
      await applyGiftToOrder(payment.order_id, order.culqi_order_id)
      const stored = await getOrder(order.order_number)
      if (stored) await saveOrder({ ...stored, paymentStatus: 'paid', paymentMethod: 'gift_card_culqi', giftCardAmount: payment.gift_amount, otherPaymentAmount: payment.other_amount, otherPaymentMethod: 'culqi' })
    } else if (expiredCulqiOrder(culqiOrder, expected)) {
      await markMixedCulqiExpired(payment.order_id)
      await setGiftPaymentState(payment.order_id, 'expired')
      await releaseGiftReservation(payment.order_id)
      const stored = await getOrder(order.order_number)
      if (stored) await saveOrder({ ...stored, paymentStatus: 'expired' })
    } else await setGiftPaymentState(payment.order_id, 'reconciliation_required')
    // Pending/unknown verified orders remain reserved; releasing them could
    // enable a double spend before Culqi confirms their final state.
  }
}

export const giftCardQuote = async (paymentCode: string) => {
  const card = await cardByPaymentCode(paymentCode)
  if (!card || card.status !== 'active' || new Date(card.expires_at).getTime() <= Date.now()) return null
  await reconcileExpiredGiftReservations(card.id)
  const reservations = await database<Array<{ gift_amount: number }>>(`gift_card_order_payments?gift_card_id=eq.${encodeURIComponent(card.id)}&status=eq.reserved&select=gift_amount`)
  const balance = Math.max(0, Number(card.current_balance) - reservations.reduce((sum, item) => sum + Number(item.gift_amount), 0))
  return balance > 0 ? { balance, requiresRecipientVerification: !card.transferable } : null
}

export const reserveGiftForOrder = async (orderId: string, checkoutId: string, paymentCode: string, recipientName: string) => {
  const card = await cardByPaymentCode(paymentCode)
  if (!card) throw new Error('Gift Card unavailable')
  await reconcileExpiredGiftReservations(card.id)
  const result = await database<{ gift_amount?: number; other_amount?: number; gift_card_id?: string; expired?: boolean; reconciliation_required?: boolean }>('rpc/reserve_gift_card_for_order', {
    method: 'POST', body: JSON.stringify({ p_order_id: orderId, p_checkout_id: checkoutId, p_payment_code: paymentCode, p_recipient_name: recipientName }),
  })
  if (result.expired || result.reconciliation_required || typeof result.gift_amount !== 'number') throw new Error('Gift Card reservation expired or needs reconciliation')
  return result
}

export const getOrderGiftPayment = async (orderId: string) => one(await database<OrderGiftPayment[]>(`gift_card_order_payments?order_id=eq.${encodeURIComponent(orderId)}&select=*`))
export const getLinkedMixedCulqiCharge = async (orderId: string) => {
  const row = one(await database<Array<{ culqi_charge_id: string | null }>>(`orders?id=eq.${encodeURIComponent(orderId)}&select=culqi_charge_id`))
  return row?.culqi_charge_id ?? null
}
export const setGiftPaymentState = async (orderId: string, state: OrderGiftPayment['payment_state']) => {
  const rows = await database<Array<{ order_id: string }>>(`gift_card_order_payments?order_id=eq.${encodeURIComponent(orderId)}&status=eq.reserved&select=order_id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ payment_state: state }),
  })
  if (rows.length !== 1) throw new Error('Gift Card payment state could not be updated')
}
export const linkMixedCulqiOrder = async (orderId: string, culqiOrderId: string) => {
  const rows = await database<Array<{ id: string }>>(`orders?id=eq.${encodeURIComponent(orderId)}&culqi_order_id=is.null&payment_status=eq.pending&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ culqi_order_id: culqiOrderId }),
  })
  if (rows.length !== 1) throw new Error('Culqi order could not be linked to Gift Card order')
  await setGiftPaymentState(orderId, 'payment_pending')
}
export const linkMixedCulqiCharge = async (orderId: string, chargeId: string) => {
  const rows = await database<Array<{ id: string }>>(`orders?id=eq.${encodeURIComponent(orderId)}&culqi_charge_id=is.null&payment_status=eq.pending&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ culqi_charge_id: chargeId }),
  })
  if (rows.length !== 1) throw new Error('Culqi charge could not be linked to order')
}
export const markMixedCulqiExpired = async (orderId: string) => {
  const rows = await database<Array<{ id: string }>>(`orders?id=eq.${encodeURIComponent(orderId)}&payment_status=eq.pending&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ payment_status: 'expired' }),
  })
  if (rows.length !== 1) throw new Error('Culqi expiration could not be linked to order')
}
export const applyGiftToOrder = (orderId: string, culqiReference: string | null = null) => database<{ gift_amount: number; other_amount: number; idempotent: boolean }>('rpc/apply_gift_card_to_order', {
  method: 'POST', body: JSON.stringify({ p_order_id: orderId, p_culqi_reference: culqiReference }),
})
export const releaseGiftReservation = (orderId: string) => database<boolean>('rpc/release_gift_card_order_reservation', { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) })
export const rejectGiftOrder = (orderId: string, reason: string, comment: string, rejectedBy: string, actor: string) => database<{ gift_restored: boolean; culqi_refund_required: boolean }>('rpc/reject_gift_card_order', {
  method: 'POST', body: JSON.stringify({ p_order_id: orderId, p_reason: reason, p_comment: comment, p_rejected_by: rejectedBy, p_actor: actor }),
})

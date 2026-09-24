import { attachGiftCulqiOrder, createGiftPurchase, giftPurchaseLock, parseGiftPurchase } from '../lib/gift-cards'
import { json } from '../lib/request'
import { culqiGiftCardOrderNumber, matchingCulqiOrder, sanitizeCulqiErrorBody } from '../lib/culqi-verification'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const input = parseGiftPurchase(await request.json().catch(() => null))
  if (!input) return json(400, { message: 'Revisa el monto y los datos de la Gift Card.' })
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) return json(503, { message: 'El pago no está disponible temporalmente.' })
  try {
    const purchase = await createGiftPurchase(input)
    if (purchase.culqi_order_id) return json(200, { checkoutId: purchase.checkout_id, accessToken: purchase.access_token, culqiOrderId: purchase.culqi_order_id, amountInCents: Math.round(Number(purchase.amount) * 100), status: purchase.payment_status, pendingReconciliation: Boolean(purchase.culqi_charge_id) })
    if (!purchase.purchaser_phone) return json(200, { checkoutId: purchase.checkout_id, accessToken: purchase.access_token, amountInCents: Math.round(Number(purchase.amount) * 100), status: purchase.payment_status, cardOnly: true, pendingReconciliation: Boolean(purchase.culqi_charge_id) })
    const lock = await giftPurchaseLock().set(input.checkoutId, 'processing', { onlyIfNew: true })
    if (!lock.modified) return json(409, { message: 'Esta compra ya se está preparando. Espera unos segundos.' })
    const [firstName, ...lastName] = purchase.purchaser_name.split(/\s+/)
    const response = await fetch('https://api.culqi.com/v2/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(Number(purchase.amount) * 100), currency_code: 'PEN',
        description: `Gift Card The Black Cat ${purchase.checkout_id}`,
        order_number: culqiGiftCardOrderNumber(purchase.checkout_id),
        expiration_date: Math.floor(Date.now() / 1000) + 60 * 60,
        confirm: true,
        client_details: { first_name: firstName, last_name: lastName.join(' ') || 'Cliente', email: purchase.purchaser_email,
          ...(purchase.purchaser_phone ? { phone_number: purchase.purchaser_phone.replace(/\D/g, '') } : {}) },
      }),
    })
    const responseBody = await response.text()
    let data: unknown = null
    try { data = JSON.parse(responseBody) } catch { /* Culqi may return a non-JSON error. */ }
    const orderId = data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' ? data.id : ''
    if (!response.ok || !orderId.startsWith('ord_') || !matchingCulqiOrder(data, { id: orderId, orderNumber: culqiGiftCardOrderNumber(purchase.checkout_id), amountInCents: Math.round(Number(purchase.amount) * 100) })) {
      await giftPurchaseLock().delete(input.checkoutId)
      console.error('Gift Card Culqi order rejected:', response.status, !response.ok ? sanitizeCulqiErrorBody(responseBody) : 'Unexpected order response')
      return json(502, { message: 'No se pudo preparar el pago de la Gift Card.' })
    }
    await attachGiftCulqiOrder(purchase.checkout_id, orderId)
    return json(201, { checkoutId: purchase.checkout_id, accessToken: purchase.access_token, culqiOrderId: orderId, amountInCents: Math.round(Number(purchase.amount) * 100), status: 'pending' })
  } catch (error) {
    console.error('Gift Card purchase preparation failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(500, { message: 'No se pudo iniciar la compra de la Gift Card.' })
  }
}

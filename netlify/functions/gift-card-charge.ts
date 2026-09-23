import { finalizeGiftPurchase, getGiftPurchaseByAccess, giftChargeLock, recordGiftCharge } from '../lib/gift-cards'
import { json } from '../lib/request'
import { confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder } from '../lib/culqi-verification'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  const accessToken = typeof data.accessToken === 'string' ? data.accessToken.trim() : ''
  if (!/^(tkn_|ype_)[A-Za-z0-9_]+$/.test(token) || !/^[a-f0-9]{64}$/.test(accessToken)) return json(400, { message: 'Datos de pago inválidos.' })
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) return json(503, { message: 'El pago no está disponible temporalmente.' })
  try {
    const purchase = await getGiftPurchaseByAccess(accessToken)
    if (!purchase) return json(404, { message: 'Compra no encontrada.' })
    if (purchase.payment_status === 'paid') {
      const receipt = await finalizeGiftPurchase(purchase, purchase.culqi_charge_id)
      return json(200, { approved: true, receipt })
    }
    if (purchase.payment_status !== 'pending') return json(409, { message: 'Esta compra ya no está disponible.' })
    if (purchase.culqi_order_id) {
      const orderResponse = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(purchase.culqi_order_id)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      const order: unknown = await orderResponse.json().catch(() => null)
      if (!orderResponse.ok || !order || typeof order !== 'object') return json(503, { message: 'No se pudo verificar la orden de Culqi. Inténtalo más tarde.' })
      const state = 'state' in order && typeof order.state === 'string' ? order.state : ''
      const expected = { id: purchase.culqi_order_id, orderNumber: `GC-${purchase.checkout_id}`, amountInCents: Math.round(Number(purchase.amount) * 100) }
      if (state === 'paid' && confirmedCulqiOrder(order, expected)) return json(200, { approved: true, receipt: await finalizeGiftPurchase(purchase, purchase.culqi_charge_id) })
      if (state === 'expired' && expiredCulqiOrder(order, expected)) return json(409, { message: 'La orden de pago venció. Inicia una nueva compra.' })
      if (!matchingCulqiOrder(order, expected)) return json(409, { message: 'La orden de Culqi no coincide con esta compra.' })
    }
    if (purchase.culqi_charge_id) return json(202, { approved: false, pending: true, message: 'Pago en conciliación. Consulta el estado antes de reintentar.' })
    const lock = await giftChargeLock().set(purchase.checkout_id, 'processing', { onlyIfNew: true })
    if (!lock.modified) return json(409, { message: 'Este pago ya se está procesando. Consulta su estado.' })
    const [firstName, ...lastName] = purchase.purchaser_name.split(/\s+/)
    const response = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST', headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(Number(purchase.amount) * 100), currency_code: 'PEN', email: purchase.purchaser_email,
        description: `Gift Card ${purchase.checkout_id}`, source_id: token, capture: true,
        antifraud_details: { address: 'Grau 184', address_city: 'Barranca', country_code: 'PE', first_name: firstName,
          last_name: lastName.join(' ') || 'Cliente', ...(purchase.purchaser_phone ? { phone_number: purchase.purchaser_phone.replace(/\D/g, '') } : {}) },
      }),
    })
    const charge: unknown = await response.json().catch(() => null)
    const chargeId = charge && typeof charge === 'object' && 'id' in charge && typeof charge.id === 'string' ? charge.id : ''
    const approved = confirmedCulqiCharge(charge, { id: chargeId, amountInCents: Math.round(Number(purchase.amount) * 100), description: `Gift Card ${purchase.checkout_id}` })
    if (!response.ok || !chargeId.startsWith('chr_') || !approved) {
      if (response.status >= 400 && response.status < 500) await giftChargeLock().delete(purchase.checkout_id)
      console.error('Gift Card Culqi charge rejected:', response.status)
      return json(response.status >= 400 && response.status < 500 ? 402 : 502, { approved: false, message: 'El pago no fue aprobado. Revisa el medio de pago.' })
    }
    await recordGiftCharge(purchase.checkout_id, chargeId)
    const receipt = await finalizeGiftPurchase(purchase, chargeId)
    return json(200, { approved: true, receipt })
  } catch (error) {
    console.error('Gift Card charge processing failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(202, { approved: false, pending: true, message: 'El pago requiere conciliación. No vuelvas a pagar; consulta su estado.' })
  }
}

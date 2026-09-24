import { finalizeGiftPurchase, getGiftPurchaseByAccess } from '../lib/gift-cards'
import { json } from '../lib/request'
import { culqiGiftCardOrderNumber, confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder } from '../lib/culqi-verification'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const body: unknown = await request.json().catch(() => null)
  const accessToken = body && typeof body === 'object' && 'accessToken' in body && typeof body.accessToken === 'string' ? body.accessToken : ''
  if (!/^[a-f0-9]{64}$/.test(accessToken)) return json(400, { message: 'Consulta inválida.' })
  try {
    const purchase = await getGiftPurchaseByAccess(accessToken)
    if (!purchase) return json(404, { message: 'Compra no encontrada.' })
    if (purchase.payment_status === 'paid') return json(200, { status: 'paid', receipt: await finalizeGiftPurchase(purchase, purchase.culqi_charge_id) })
    if (purchase.payment_status === 'expired') return json(200, { status: 'expired' })
    const secretKey = process.env.CULQI_SECRET_KEY
    if (!secretKey || (!purchase.culqi_order_id && !purchase.culqi_charge_id)) return json(200, { status: 'pending' })
    const chargeId = purchase.culqi_charge_id
    const lookupId = chargeId ?? purchase.culqi_order_id!
    const kind = chargeId ? 'charges' : 'orders'
    const response = await fetch(`https://api.culqi.com/v2/${kind}/${encodeURIComponent(lookupId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
    const result: unknown = await response.json().catch(() => null)
    if (!response.ok || !result || typeof result !== 'object') return json(200, { status: 'pending' })
    const amountInCents = Math.round(Number(purchase.amount) * 100)
    const chargeApproved = chargeId && confirmedCulqiCharge(result, { id: chargeId, amountInCents, description: `Gift Card ${purchase.checkout_id}` })
    const orderExpected = purchase.culqi_order_id ? { id: purchase.culqi_order_id, orderNumber: culqiGiftCardOrderNumber(purchase.checkout_id), amountInCents } : null
    const orderApproved = orderExpected && confirmedCulqiOrder(result, orderExpected)
    if (orderApproved || chargeApproved) {
      return json(200, { status: 'paid', receipt: await finalizeGiftPurchase(purchase, chargeId) })
    }
    return json(200, { status: orderExpected && expiredCulqiOrder(result, orderExpected) ? 'expired' : 'pending' })
  } catch (error) {
    console.error('Gift Card payment status check failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(503, { status: 'pending', message: 'No fue posible verificar el pago ahora.' })
  }
}

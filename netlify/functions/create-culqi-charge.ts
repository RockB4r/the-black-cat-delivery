import { notifyOrder } from '../lib/notifications'
import { getOrderByCheckoutId, saveOrder, type StoreOrder } from '../lib/orders'
import { getStore } from '@netlify/blobs'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { getUnavailableProducts, ProductAvailabilityError } from '../lib/product-availability'
import { confirmPromotionUse, releasePromotion } from '../lib/promotions'
import { applyGiftToOrder, getOrderGiftPayment, linkMixedCulqiCharge, setGiftPaymentState } from '../lib/gift-cards'
import { confirmedCulqiCharge, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder } from '../lib/culqi-verification'

type CulqiErrorData = {
  type?: unknown
  code?: unknown
  decline_code?: unknown
  merchant_message?: unknown
  user_message?: unknown
}

const safeCulqiText = (value: unknown) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, 300)
  : undefined

const culqiErrorDetails = (data: unknown) => {
  const error = typeof data === 'object' && data !== null ? data as CulqiErrorData : {}
  return {
    type: safeCulqiText(error.type),
    code: safeCulqiText(error.code),
    declineCode: safeCulqiText(error.decline_code),
    merchantMessage: safeCulqiText(error.merchant_message),
    userMessage: safeCulqiText(error.user_message),
  }
}

const customerNames = (fullName: string) => {
  const [firstName, ...lastNameParts] = fullName.trim().split(/\s+/)
  return { firstName: firstName || 'Cliente', lastName: lastNameParts.join(' ') || 'Cliente' }
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, { approved: false, message: 'Método no permitido.' })
  }
  const kitchenAvailability = await getOnlineOrderingAvailability()
  if (!kitchenAvailability.isOpen) return json(403, { approved: false, message: kitchenAvailability.message })

  const body: unknown = await request.json().catch(() => null)
  const data = body as Record<string, unknown> | null
  const token = typeof data?.token === 'string' ? data.token.trim() : ''
  const internalOrderId = typeof data?.internalOrderId === 'string' ? data.internalOrderId.trim() : ''
  const paymentMethod = token.startsWith('ype_') ? 'wallet' : 'card'
  const input = parseOrderInput(body, paymentMethod)
  const amount = data?.amount
  if (!token || !input || !Number.isSafeInteger(amount) || data?.currency !== 'PEN') return json(400, { approved: false, message: 'Los datos de pago no son válidos.' })

  const order = await getOrderByCheckoutId(input.checkoutId)
  if (!order || order.paymentStatus === 'expired' || !internalOrderId || order.databaseOrderId !== internalOrderId) return json(409, { approved: false, message: 'Este intento de pago ya no está disponible. Inicia un nuevo pedido.' })
  if (order.paymentStatus === 'paid') return json(200, { approved: true, chargeId: order.culqiChargeId, orderId: order.orderId })
  const giftPayment = order.databaseOrderId ? await getOrderGiftPayment(order.databaseOrderId) : null
  if ((giftPayment && giftPayment.status !== 'reserved') || amount !== Math.round((giftPayment?.other_amount ?? order.total) * 100) || order.email !== input.email || order.checkoutId !== input.checkoutId) return json(409, { approved: false, message: 'Los datos del intento de pago no coinciden. Inicia un nuevo pedido.' })
  if (giftPayment && (!order.culqiOrderId || new Date(giftPayment.expires_at).getTime() <= Date.now())) return json(409, { approved: false, message: 'La reserva de Gift Card venció o aún no tiene una orden Culqi vinculada.' })

  let chargeAttempted = false
  try {
    const unavailableProducts = await getUnavailableProducts(order.items)
    if (unavailableProducts.length) return json(409, { approved: false, code: 'PRODUCT_UNAVAILABLE', unavailable_products: unavailableProducts, message: 'Uno o más productos ya no están disponibles.' })
  } catch (error) {
    if (error instanceof ProductAvailabilityError) return json(503, { approved: false, code: 'PRODUCT_AVAILABILITY_UNAVAILABLE', message: 'No fue posible verificar la disponibilidad. Inténtalo nuevamente.' })
    throw error
  }

  const paymentLockKey = giftPayment ? `${input.checkoutId}/gift-mixed` : `${input.checkoutId}/${paymentMethod}`
  const paymentLock = await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).set(paymentLockKey, new Date().toISOString(), { onlyIfNew: true })
  if (!paymentLock.modified) return json(409, { approved: false, message: 'Este pago ya se está procesando. Espera unos segundos antes de reintentar.' })

  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey) {
    await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey)
    console.error('CULQI_SECRET_KEY is not configured.')
    return json(500, { approved: false, message: 'El pago no está disponible temporalmente.' })
  }

  try {
    if (giftPayment && order.culqiOrderId && order.databaseOrderId) {
      const orderResponse = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(order.culqiOrderId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      const culqiOrder: unknown = await orderResponse.json().catch(() => null)
      if (!orderResponse.ok || !culqiOrder || typeof culqiOrder !== 'object') { await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey); return json(503, { approved: false, message: 'No se pudo verificar el pago complementario. No repitas el cargo.' }) }
      const state = 'state' in culqiOrder && typeof culqiOrder.state === 'string' ? culqiOrder.state : ''
      const expected = { id: order.culqiOrderId, orderNumber: order.orderId, amountInCents: amount as number }
      if (state === 'paid' && !confirmedCulqiOrder(culqiOrder, expected)) throw new Error('Culqi paid order does not match this checkout')
      if (state === 'paid') {
        await setGiftPaymentState(order.databaseOrderId, 'paid')
        await applyGiftToOrder(order.databaseOrderId, order.culqiOrderId)
        const paidOrder: StoreOrder = { ...order, paymentMethod: 'gift_card_culqi', paymentStatus: 'paid', giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, otherPaymentMethod: paymentMethod }
        await saveOrder(paidOrder)
        if (paidOrder.discountCode) await confirmPromotionUse({ checkoutId: paidOrder.checkoutId, orderId: paidOrder.orderId })
        try { await notifyOrder(paidOrder) } catch (error) { console.error('Order notification failed after confirmed Culqi order:', error instanceof Error ? error.message : 'Unknown error') }
        return json(200, { approved: true, orderId: paidOrder.orderId })
      }
      if (state === 'expired' && !expiredCulqiOrder(culqiOrder, expected)) throw new Error('Culqi expired order does not match this checkout')
      if (state === 'expired') { await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey); return json(409, { approved: false, message: 'La orden de pago venció. Inicia un nuevo pedido.' }) }
      if (!matchingCulqiOrder(culqiOrder, expected)) throw new Error('Culqi order does not match this checkout')
      const expiresAt = 'expiration_date' in culqiOrder && typeof culqiOrder.expiration_date === 'number' ? culqiOrder.expiration_date : 0
      if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 120) { await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey); return json(409, { approved: false, message: 'La orden de pago está por vencer. Inicia un nuevo pedido.' }) }
    }
    const { firstName, lastName } = customerNames(order.customer)
    const phoneNumber = order.phone.replace(/\D/g, '')
    chargeAttempted = true
    const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency_code: 'PEN',
        email: order.email,
        description: `Pedido ${order.orderId}`,
        source_id: token,
        capture: true,
        antifraud_details: {
          address: order.address || 'Recojo en local',
          address_city: 'Barranca',
          country_code: 'PE',
          first_name: firstName,
          last_name: lastName,
          phone_number: phoneNumber,
        },
      }),
    })

    const culqiData: unknown = await culqiResponse.json().catch(() => null)
    if (!culqiResponse.ok) {
      const details = culqiErrorDetails(culqiData)
      console.error('Culqi charge rejected:', { status: culqiResponse.status, paymentMethod, ...details })
      if (culqiResponse.status >= 400 && culqiResponse.status < 500) {
        if (giftPayment && order.databaseOrderId) {
          // This charge attempt failed; the Culqi order may still be payable.
          // Keep the Gift Card reservation until that order is resolved.
          try { await setGiftPaymentState(order.databaseOrderId, 'failed') }
          catch (error) { console.error('Gift Card failed-attempt state update failed:', error instanceof Error ? error.message : 'Unknown error') }
        }
        await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey)
        if (order.discountCode) {
          try {
            await releasePromotion(order.checkoutId)
          } catch (error) {
            console.error('Promotion release failed after rejected payment:', error instanceof Error ? error.message : 'Unknown error')
          }
        }
        return json(402, {
          approved: false,
          code: details.declineCode ?? details.code ?? 'PAYMENT_REJECTED',
          message: details.userMessage ?? 'El pago fue rechazado. Verifica tus datos o intenta otro método.',
        })
      }

      if (!giftPayment) await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey)
      return json(502, { approved: false, message: giftPayment ? 'El pago requiere verificación. No repitas el cargo; contacta al bar con tu pedido.' : 'No fue posible procesar el pago. Inténtalo nuevamente.' })
    }

    const chargeId = typeof culqiData === 'object' && culqiData !== null && 'id' in culqiData && typeof culqiData.id === 'string'
      ? culqiData.id
      : undefined

    if (!chargeId) throw new Error('Culqi did not return a charge identifier.')
    if (giftPayment) {
      if (!order.databaseOrderId) throw new Error('Gift Card order has no database identifier')
      if (!confirmedCulqiCharge(culqiData, { id: chargeId, amountInCents: amount as number, description: `Pedido ${order.orderId}` })) throw new Error('Culqi charge is not confirmed for this order and amount')
      await linkMixedCulqiCharge(order.databaseOrderId, chargeId)
      await setGiftPaymentState(order.databaseOrderId, 'paid')
      await applyGiftToOrder(order.databaseOrderId, chargeId)
    }
    const paidOrder: StoreOrder = { ...order, paymentMethod: giftPayment ? 'gift_card_culqi' : paymentMethod, paymentStatus: 'paid', culqiChargeId: chargeId,
      ...(giftPayment ? { giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, otherPaymentMethod: paymentMethod } : {}) }

    try {
      await saveOrder(paidOrder)
    } catch (error) {
      console.error('Paid Culqi charge could not be persisted:', error instanceof Error ? error.message : 'Unknown error')
      return json(200, { approved: true, chargeId, orderId: order.orderId, message: 'Pago aprobado. Conserva el código de tu pedido.' })
    }

    if (order.discountCode) {
      try {
        await confirmPromotionUse({ checkoutId: order.checkoutId, orderId: order.orderId })
      } catch (error) {
        console.error('Promotion confirmation failed after approved payment:', error instanceof Error ? error.message : 'Unknown error')
      }
    }

    try {
      await notifyOrder(paidOrder)
    } catch (error) {
      console.error('Order notification failed after approved payment:', error instanceof Error ? error.message : 'Unknown error')
    }
    return json(200, { approved: true, chargeId, orderId: order.orderId })
  } catch (error) {
    if (!giftPayment || !chargeAttempted) await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey)
    console.error('Culqi charge request failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(502, { approved: false, message: giftPayment && chargeAttempted ? 'El pago requiere verificación. No repitas el cargo; contacta al bar con tu pedido.' : 'No fue posible conectar con el servicio de pago. Inténtalo nuevamente.' })
  }
}

import { notifyOrder } from '../lib/notifications'
import { getOrderByCheckoutId, saveOrder, type StoreOrder } from '../lib/orders'
import { getStore } from '@netlify/blobs'
import { json, parseOrderInput } from '../lib/request'
import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { getUnavailableProducts, ProductAvailabilityError } from '../lib/product-availability'
import { confirmPromotionUse, releasePromotion } from '../lib/promotions'
import { applyGiftToOrder, beginMixedCulqiAttempt, completeMixedCulqiAttempt, getMixedCulqiAttempts, getOrderGiftPayment, markMixedCulqiAttempt } from '../lib/gift-cards'
import { evaluateOriginalChargeResponse, confirmedCulqiOrder, expiredCulqiOrder, matchingCulqiOrder, getCulqiEnvironment, validateCulqiReferences } from '../lib/culqi-verification'
import { giftCardOperationBlock } from '../lib/gift-card-operations'
import { randomBytes } from 'node:crypto'
import { transitionMixed3DS } from '../lib/gift-cards'
import { classifyMixedCharge, mixed3DSContextHash, continuationHash } from '../lib/mixed-3ds'
import { parseAuthentication3DS, validDeviceFingerprint } from '../../src/lib/culqi3ds'

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
  if (!getCulqiEnvironment()) return new Response(null, { status: 503 })
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
  if (!validateCulqiReferences(order.culqiOrderId, order.culqiChargeId)) return json(409, { approved: false, message: 'El pedido no pertenece al entorno de pago configurado.' })
  if (order.paymentStatus === 'paid') return json(200, { approved: true, chargeId: order.culqiChargeId, orderId: order.orderId })
  const giftPayment = order.databaseOrderId ? await getOrderGiftPayment(order.databaseOrderId) : null
  const threeDS = data?.threeDS && typeof data.threeDS === 'object' && !Array.isArray(data.threeDS) ? data.threeDS as Record<string, unknown> : null
  const fingerprint = typeof data?.deviceFingerprint === 'string' ? data.deviceFingerprint : ''
  const authentication = threeDS?.action === 'continue' ? parseAuthentication3DS(threeDS.parameters) : null
  const continuation = typeof threeDS?.continuationToken === 'string' ? threeDS.continuationToken : ''
  const resumeAttemptId = typeof threeDS?.attemptId === 'string' ? threeDS.attemptId : ''
  if (data?.threeDS && !threeDS) return json(400, { approved: false, message: 'Contexto 3DS inválido.' })
  if (threeDS && (!giftPayment || !/^[a-f0-9]{64}$/.test(continuation) || !/^[a-f0-9-]{36}$/i.test(resumeAttemptId)
    || !['continue', 'cancel'].includes(String(threeDS.action)) || (threeDS.action === 'continue' && !authentication))) return json(400, { approved: false, message: 'Continuación 3DS inválida.' })
  const mixedCard = !!giftPayment && paymentMethod === 'card'
  if (mixedCard && (!validDeviceFingerprint(fingerprint) || !new RegExp(`^tkn_${getCulqiEnvironment()}_[A-Za-z0-9]+$`).test(token))) return json(400, { approved: false, message: 'Dispositivo o token de tarjeta inválido.' })
  const contextHash = mixedCard ? mixed3DSContextHash({ checkoutId: input.checkoutId, orderId: internalOrderId, token, fingerprint, amount: Number(amount), currency: 'PEN' }) : ''
  if ((giftPayment && giftPayment.status !== 'reserved') || amount !== Math.round((giftPayment?.other_amount ?? order.total) * 100) || order.email !== input.email || order.checkoutId !== input.checkoutId) return json(409, { approved: false, message: 'Los datos del intento de pago no coinciden. Inicia un nuevo pedido.' })
  if (giftPayment && (!order.culqiOrderId || new Date(giftPayment.expires_at).getTime() <= Date.now())) return json(409, { approved: false, message: 'La reserva de Gift Card venció o aún no tiene una orden Culqi vinculada.' })

  let chargeAttempted = false
  let mixedAttemptId: string | null = null
  try {
    const unavailableProducts = await getUnavailableProducts(order.items)
    if (unavailableProducts.length) return json(409, { approved: false, code: 'PRODUCT_UNAVAILABLE', unavailable_products: unavailableProducts, message: 'Uno o más productos ya no están disponibles.' })
  } catch (error) {
    if (error instanceof ProductAvailabilityError) return json(503, { approved: false, code: 'PRODUCT_AVAILABILITY_UNAVAILABLE', message: 'No fue posible verificar la disponibilidad. Inténtalo nuevamente.' })
    throw error
  }

  const paymentLockKey = giftPayment ? `${input.checkoutId}/gift-mixed` : `${input.checkoutId}/${paymentMethod}`
  const releasePaymentLock = async () => {
    if (!threeDS) await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).delete(paymentLockKey)
  }
  // Continuations do NOT remove or reacquire the general lock. A durable single-use RPC gates them.
  if (!threeDS) {
    const paymentLock = await getStore({ name: 'the-black-cat-payment-locks', consistency: 'strong' }).set(paymentLockKey, new Date().toISOString(), { onlyIfNew: true })
    if (!paymentLock.modified) return json(409, { approved: false, message: 'Este pago ya se está procesando. Espera unos segundos antes de reintentar.' })
  }

  const secretKey = process.env.CULQI_SECRET_KEY
  if (!getCulqiEnvironment(secretKey)) {
    await releasePaymentLock()
    console.error('CULQI_SECRET_KEY is not configured.')
    return json(500, { approved: false, message: 'El pago no está disponible temporalmente.' })
  }

  try {
    if (threeDS) {
      if (!mixedCard) return json(400, { approved: false, message: '3DS solo disponible para tarjeta en pago mixto.' })
      const claimed = await transitionMixed3DS(internalOrderId, resumeAttemptId, contextHash, continuationHash(continuation), threeDS.action === 'cancel' ? 'cancel' : 'continue')
      if (!claimed) return json(409, { approved: false, message: 'Continuación ya utilizada, vencida o no coincidente. No repitas el cargo.' })
      mixedAttemptId = resumeAttemptId
      if (threeDS.action === 'cancel') return json(202, { approved: false, message: 'Autenticación cancelada. La reserva queda protegida; contacta al bar.' })
    }
    if (giftPayment && order.culqiOrderId && order.databaseOrderId) {
      const orderResponse = await fetch(`https://api.culqi.com/v2/orders/${encodeURIComponent(order.culqiOrderId)}`, { headers: { Authorization: `Bearer ${secretKey}` } })
      const culqiOrder: unknown = await orderResponse.json().catch(() => null)
      if (!orderResponse.ok || !culqiOrder || typeof culqiOrder !== 'object') { await releasePaymentLock(); return json(503, { approved: false, message: 'No se pudo verificar el pago complementario. No repitas el cargo.' }) }
      const state = 'state' in culqiOrder && typeof culqiOrder.state === 'string' ? culqiOrder.state : ''
      const expected = { id: order.culqiOrderId, orderNumber: order.orderId, amountInCents: amount as number }
      if (state === 'paid' && !confirmedCulqiOrder(culqiOrder, expected)) throw new Error('Culqi paid order does not match this checkout')
      if (state === 'paid') {
        const attempts = await getMixedCulqiAttempts(order.databaseOrderId)
        const unresolved = attempts.find((attempt) => attempt.status === 'processing' || attempt.status === 'reconciliation_required')
        if (unresolved) await completeMixedCulqiAttempt(order.databaseOrderId, unresolved.id, order.culqiOrderId, null, 'verified_order')
        else await applyGiftToOrder(order.databaseOrderId, order.culqiOrderId)
        const paidOrder: StoreOrder = { ...order, paymentMethod: 'gift_card_culqi', paymentStatus: 'paid', giftCardAmount: giftPayment.gift_amount, otherPaymentAmount: giftPayment.other_amount, otherPaymentMethod: paymentMethod }
        await saveOrder(paidOrder)
        if (paidOrder.discountCode) await confirmPromotionUse({ checkoutId: paidOrder.checkoutId, orderId: paidOrder.orderId })
        try { await notifyOrder(paidOrder) } catch (error) { console.error('Order notification failed after confirmed Culqi order:', error instanceof Error ? error.message : 'Unknown error') }
        return json(200, { approved: true, orderId: paidOrder.orderId })
      }
      if (state === 'expired' && !expiredCulqiOrder(culqiOrder, expected)) throw new Error('Culqi expired order does not match this checkout')
      if (state === 'expired') { await releasePaymentLock(); return json(409, { approved: false, message: 'La orden de pago venció. Inicia un nuevo pedido.' }) }
      if (!matchingCulqiOrder(culqiOrder, expected)) throw new Error('Culqi order does not match this checkout')
      const expiresAt = 'expiration_date' in culqiOrder && typeof culqiOrder.expiration_date === 'number' ? culqiOrder.expiration_date : 0
      if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 120) { await releasePaymentLock(); return json(409, { approved: false, message: 'La orden de pago está por vencer. Inicia un nuevo pedido.' }) }
    }
    const { firstName, lastName } = customerNames(order.customer)
    if (giftPayment && !threeDS) {
      const blocked = await giftCardOperationBlock('redemption')
      if (blocked) {
        await releasePaymentLock()
        return blocked
      }
    }
    const phoneNumber = order.phone.replace(/\D/g, '')
    const continuationToken = mixedCard && !threeDS ? randomBytes(32).toString('hex') : continuation
    if (!threeDS && giftPayment && order.databaseOrderId && order.culqiOrderId) {
      const attempt = await beginMixedCulqiAttempt(order.databaseOrderId, input.checkoutId, order.culqiOrderId)
      mixedAttemptId = attempt.id
      if (mixedCard && !await transitionMixed3DS(internalOrderId, mixedAttemptId, contextHash, continuationHash(continuationToken), 'initialize')) throw new Error('Could not initialize 3DS context')
    }
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
        ...(giftPayment ? { metadata: { checkout_id: input.checkoutId, attempt_id: mixedAttemptId } } : {}),
        antifraud_details: {
          address: order.address || 'Recojo en local',
          address_city: 'Barranca',
          country_code: 'PE',
          first_name: firstName,
          last_name: lastName,
          phone_number: phoneNumber,
          ...(mixedCard ? { device_finger_print_id: fingerprint } : {}),
        },
        ...(threeDS?.action === 'continue' ? { authentication_3DS: authentication } : {}),
      }),
    })

    const culqiData: unknown = await culqiResponse.json().catch(() => null)
    const responseId = culqiData && typeof culqiData === 'object' && 'id' in culqiData && typeof culqiData.id === 'string' ? culqiData.id : ''
    const mixedEvidence = giftPayment ? classifyMixedCharge(culqiData, { id: responseId, amountInCents: Number(amount), description: `Pedido ${order.orderId}`, checkoutId: input.checkoutId, attemptId: mixedAttemptId ?? undefined }, culqiResponse.status) : null
    if (mixedEvidence === 'authentication_required' && mixedCard && !threeDS && mixedAttemptId) {
      if (!await transitionMixed3DS(internalOrderId, mixedAttemptId, contextHash, continuationHash(continuationToken), 'await')) throw new Error('Could not persist authentication phase')
      return json(202, { approved: false, authenticationRequired: true, attemptId: mixedAttemptId, continuationToken })
    }
    if (giftPayment && mixedEvidence !== 'approved') {
      if (mixedAttemptId) await markMixedCulqiAttempt(mixedAttemptId, mixedEvidence === 'rejected' ? 'rejected' : 'reconciliation_required', mixedEvidence === 'rejected' ? 'culqi_body_rejected' : 'culqi_ambiguous')
      return json(mixedEvidence === 'rejected' ? 402 : 502, { approved: false, message: mixedEvidence === 'rejected' ? 'Pago rechazado. No repitas el cargo; la reserva queda protegida.' : 'El pago requiere verificación. No repitas el cargo; contacta al bar con tu pedido.' })
    }
    if (!culqiResponse.ok) {
      const details = culqiErrorDetails(culqiData)
      console.error('Culqi charge rejected:', { status: culqiResponse.status, paymentMethod, ...details })
      if (culqiResponse.status >= 400 && culqiResponse.status < 500) {
        if (giftPayment && order.databaseOrderId) {
          // This charge attempt failed; the Culqi order may still be payable.
          // Keep the Gift Card reservation until that order is resolved.
          if (mixedAttemptId) {
            try { await markMixedCulqiAttempt(mixedAttemptId, 'rejected', 'culqi_http_4xx') }
            catch (error) {
              console.error('Gift Card rejected-attempt state update failed:', error instanceof Error ? error.message : 'Unknown error')
              return json(502, { approved: false, message: 'El intento requiere verificación. No repitas el cargo.' })
            }
          }
        }
        await releasePaymentLock()
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

      if (mixedAttemptId) await markMixedCulqiAttempt(mixedAttemptId, 'reconciliation_required', 'culqi_http_5xx').catch((error: unknown) => console.error('Could not persist uncertain payment state:', error instanceof Error ? error.message : 'Unknown error'))
      if (!giftPayment) await releasePaymentLock()
      return json(502, { approved: false, message: giftPayment ? 'El pago requiere verificación. No repitas el cargo; contacta al bar con tu pedido.' : 'No fue posible procesar el pago. Inténtalo nuevamente.' })
    }

    const chargeId = typeof culqiData === 'object' && culqiData !== null && 'id' in culqiData && typeof culqiData.id === 'string'
      ? culqiData.id
      : undefined

    if (!chargeId || evaluateOriginalChargeResponse(culqiData, { id: chargeId, amountInCents: amount as number,
      description: `Pedido ${order.orderId}`, checkoutId: input.checkoutId, attemptId: mixedAttemptId ?? undefined }, culqiResponse.status) !== 'approved') throw new Error('Culqi charge is not confirmed for this order and environment')
    if (giftPayment) {
      if (!order.databaseOrderId) throw new Error('Gift Card order has no database identifier')
      if (!mixedAttemptId) throw new Error('Mixed Culqi attempt was not persisted')
      await completeMixedCulqiAttempt(order.databaseOrderId, mixedAttemptId, chargeId, chargeId, 'culqi_charge')
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
    if (mixedAttemptId) await markMixedCulqiAttempt(mixedAttemptId, 'reconciliation_required', 'culqi_ambiguous').catch((markError: unknown) => console.error('Could not persist uncertain payment state:', markError instanceof Error ? markError.message : 'Unknown error'))
    if (!giftPayment || !chargeAttempted) await releasePaymentLock()
    console.error('Culqi charge request failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(502, { approved: false, message: giftPayment ? 'El pago requiere verificación. No repitas el cargo; contacta al bar con tu pedido.' : 'No fue posible conectar con el servicio de pago. Inténtalo nuevamente.' })
  }
}

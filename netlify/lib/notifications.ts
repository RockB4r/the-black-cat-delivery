import { getStore } from '@netlify/blobs'
import type { NotificationStatus, StoreOrder } from './orders'
import { saveOrder } from './orders'

const notificationLocks = () => getStore({ name: 'the-black-cat-notification-locks', consistency: 'strong' })

const paymentLabel = (order: StoreOrder) => order.paymentStatus === 'paid' ? 'PAGADO' : 'PAGO PENDIENTE - EFECTIVO'
const message = (order: StoreOrder) => [
  `NUEVO PEDIDO ${paymentLabel(order)}`,
  order.orderId,
  '',
  `Cliente: ${order.customer}`,
  `Teléfono: ${order.phone}`,
  `Dirección: ${order.address || 'Recojo en el bar'}`,
  '',
  ...order.items.flatMap((item) => [`${item.quantity} x ${item.name}`, ...(item.note ? [`- ${item.note}`] : [])]),
  '',
  `Total: S/ ${order.total.toFixed(2)}`,
  `Pago: ${order.paymentMethod.toUpperCase()}`,
  `Estado: ${paymentLabel(order)}`,
  ...(order.culqiChargeId ? ['', `Operación Culqi: ${order.culqiChargeId}`] : []),
  ...(order.culqiOrderId ? ['', `Orden Culqi: ${order.culqiOrderId}`] : []),
].join('\n')

const lock = async (orderId: string, channel: string) => {
  const result = await notificationLocks().set(`${orderId}/${channel}`, new Date().toISOString(), { onlyIfNew: true })
  return result.modified
}

const unlock = async (orderId: string, channel: string) => notificationLocks().delete(`${orderId}/${channel}`)

export const sendOrderEmailNotification = async (order: StoreOrder): Promise<NotificationStatus> => {
  if (order.emailNotificationStatus === 'sent') return 'sent'
  if (!await lock(order.orderId, 'email')) return order.emailNotificationStatus
  try {
    const apiKey = process.env.RESEND_API_KEY
    const to = process.env.ORDER_NOTIFICATION_EMAIL
    const from = process.env.ORDER_NOTIFICATION_FROM_EMAIL
    if (!apiKey || !to || !from) throw new Error('Email notification environment is incomplete.')
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `Nuevo pedido ${order.orderId}`, text: message(order) }),
    })
    if (!response.ok) throw new Error(`Resend returned ${response.status}.`)
    return 'sent'
  } catch (error) {
    console.error(`Email notification failed for ${order.orderId}:`, error)
    await unlock(order.orderId, 'email')
    return 'failed'
  }
}

export const sendOrderWhatsAppNotification = async (order: StoreOrder): Promise<NotificationStatus> => {
  if (order.whatsappNotificationStatus === 'sent') return 'sent'
  if (!await lock(order.orderId, 'whatsapp')) return order.whatsappNotificationStatus
  try {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const storePhone = process.env.WHATSAPP_STORE_PHONE
    const version = process.env.WHATSAPP_GRAPH_API_VERSION
    if (!token || !phoneNumberId || !storePhone || !version) throw new Error('WhatsApp notification environment is incomplete.')
    const templateName = process.env.WHATSAPP_ORDER_TEMPLATE_NAME
    const body = templateName
      ? { messaging_product: 'whatsapp', to: storePhone, type: 'template', template: { name: templateName, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_PE' }, components: [{ type: 'body', parameters: [{ type: 'text', text: message(order) }] }] } }
      : { messaging_product: 'whatsapp', to: storePhone, type: 'text', text: { body: message(order), preview_url: false } }
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`WhatsApp returned ${response.status}.`)
    return 'sent'
  } catch (error) {
    console.error(`WhatsApp notification failed for ${order.orderId}:`, error)
    await unlock(order.orderId, 'whatsapp')
    return 'failed'
  }
}

export const notifyOrder = async (order: StoreOrder) => {
  const emailNotificationStatus = await sendOrderEmailNotification(order)
  const refreshedOrder = { ...order, emailNotificationStatus }
  await saveOrder(refreshedOrder)
  const whatsappNotificationStatus = await sendOrderWhatsAppNotification(refreshedOrder)
  const updatedOrder = { ...refreshedOrder, whatsappNotificationStatus }
  await saveOrder(updatedOrder)
  return updatedOrder
}

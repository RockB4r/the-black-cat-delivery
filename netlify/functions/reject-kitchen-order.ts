import { sendOrderRejectionEmail } from '../lib/notifications'
import { json } from '../lib/request'

const kitchenEmail = 'kitchen@theblackcatrockbar.com'
const reasons = new Set(['Stock agotado', 'Producto no disponible', 'Cocina cerrada por horario', 'Problema técnico', 'Otro'])

type DatabaseOrder = {
  id: string
  order_number: string
  customer_name: string
  customer_email: string | null
  status: string
}

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const authorization = request.headers.get('authorization')
  if (!url || !serviceKey || !authorization?.startsWith('Bearer ')) return json(401, { message: 'No autorizado.' })

  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const orderId = typeof data?.orderId === 'string' ? data.orderId.trim() : ''
  const reason = typeof data?.reason === 'string' ? data.reason.trim() : ''
  const comment = typeof data?.comment === 'string' ? data.comment.trim().slice(0, 500) : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) || !reasons.has(reason)) return json(400, { message: 'Los datos del rechazo no son válidos.' })

  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } })
    const user: unknown = await userResponse.json().catch(() => null)
    const userId = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : ''
    const userEmail = user && typeof user === 'object' && 'email' in user && typeof user.email === 'string' ? user.email.toLowerCase() : ''
    if (!userResponse.ok || !userId || !userEmail) return json(401, { message: 'Sesión no válida.' })

    let allowed = userEmail === kitchenEmail
    if (!allowed) {
      const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,active`, { headers: headers(serviceKey) })
      const profiles: unknown = await profileResponse.json().catch(() => null)
      allowed = Array.isArray(profiles) && profiles.some((profile) => profile && typeof profile === 'object' && profile.role === 'admin' && profile.active === true)
    }
    if (!allowed) return json(403, { message: 'No tienes permiso para rechazar pedidos.' })

    const orderResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,customer_name,customer_email,status`, { headers: headers(serviceKey) })
    const orders: unknown = await orderResponse.json().catch(() => null)
    const order = Array.isArray(orders) && orders[0] && typeof orders[0] === 'object' ? orders[0] as DatabaseOrder : null
    if (!order || order.status !== 'nuevo') return json(409, { message: 'El pedido ya no está disponible para rechazo.' })

    const updateResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&status=eq.nuevo`, { method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=representation' }), body: JSON.stringify({ status: 'rechazado', rejection_reason: reason, rejection_comment: comment || null, rejected_by: userEmail }) })
    const updated: unknown = await updateResponse.json().catch(() => null)
    if (!updateResponse.ok || !Array.isArray(updated) || updated.length !== 1) return json(409, { message: 'No fue posible rechazar el pedido. Intenta actualizar la pantalla.' })

    const emailSent = order.customer_email ? await sendOrderRejectionEmail({ orderId: order.order_number, customer: order.customer_name, email: order.customer_email, reason, comment }) === 'sent' : false
    return json(200, { rejected: true, emailSent })
  } catch (error) {
    console.error('Kitchen order rejection failed:', error)
    return json(500, { message: 'No fue posible rechazar el pedido.' })
  }
}

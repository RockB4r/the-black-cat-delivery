import { json } from '../lib/request'

const kitchenEmail = 'kitchen@theblackcatrockbar.com'
const orderStatuses = new Set(['preparando', 'listo', 'en_camino', 'entregado'])

type DatabaseOrder = { id: string; status: string; order_type: 'delivery' | 'pick_up' }

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

const canTransition = (order: DatabaseOrder, nextStatus: string) => {
  if (order.status === 'nuevo') return nextStatus === 'preparando'
  if (order.status === 'preparando') return nextStatus === 'listo'
  if (order.status === 'listo') return order.order_type === 'delivery' ? nextStatus === 'en_camino' : nextStatus === 'entregado'
  return order.status === 'en_camino' && nextStatus === 'entregado'
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const authorization = request.headers.get('authorization')
  if (!url || !serviceKey || !authorization?.startsWith('Bearer ')) return json(401, { message: 'No autorizado.' })

  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const orderId = typeof data?.orderId === 'string' ? data.orderId.trim() : ''
  const nextStatus = typeof data?.status === 'string' ? data.status : ''
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)
  if (!validId || !orderStatuses.has(nextStatus)) return json(400, { message: 'Los datos del pedido no son válidos.' })

  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } })
    const user: unknown = await userResponse.json().catch(() => null)
    const userId = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : ''
    const email = user && typeof user === 'object' && 'email' in user && typeof user.email === 'string' ? user.email.toLowerCase() : ''
    if (!userResponse.ok || !userId || !email) return json(401, { message: 'Sesión no válida.' })

    let allowed = email === kitchenEmail
    if (!allowed) {
      const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,active`, { headers: headers(serviceKey) })
      const profiles: unknown = await profileResponse.json().catch(() => null)
      allowed = Array.isArray(profiles) && profiles.some((profile) => profile && typeof profile === 'object' && (profile.role === 'manager' || profile.role === 'admin') && profile.active === true)
    }
    if (!allowed) return json(403, { message: 'No tienes permiso para actualizar pedidos.' })

    const orderResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,order_type`, { headers: headers(serviceKey) })
    const orders: unknown = await orderResponse.json().catch(() => null)
    const order = Array.isArray(orders) && orders[0] && typeof orders[0] === 'object' ? orders[0] as DatabaseOrder : null
    if (!order || !canTransition(order, nextStatus)) return json(409, { message: 'El pedido ya no permite ese cambio de estado.' })

    const updateResponse = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&status=eq.${encodeURIComponent(order.status)}`, {
      method: 'PATCH',
      headers: headers(serviceKey, { Prefer: 'return=representation' }),
      body: JSON.stringify({ status: nextStatus }),
    })
    const updated: unknown = await updateResponse.json().catch(() => null)
    if (!updateResponse.ok || !Array.isArray(updated) || updated.length !== 1) return json(409, { message: 'No fue posible actualizar el pedido. Actualiza la pantalla e intenta nuevamente.' })

    return json(200, { updated: true })
  } catch (error) {
    console.error('Kitchen order status update failed:', error)
    return json(500, { message: 'No fue posible actualizar el estado del pedido.' })
  }
}

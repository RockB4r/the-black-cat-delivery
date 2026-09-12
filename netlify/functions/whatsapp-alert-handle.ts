const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })
const alertIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const url = process.env.SUPABASE_URL; const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; const authorization = request.headers.get('authorization')
  if (!url || !serviceKey || !authorization?.startsWith('Bearer ')) return json(401, { message: 'No autorizado.' })
  const body: unknown = await request.json().catch(() => null); const data = body && typeof body === 'object' ? body as Record<string, unknown> : null; const alertId = typeof data?.alertId === 'string' ? data.alertId.trim() : ''
  if (!alertIdPattern.test(alertId)) return json(400, { message: 'Alerta no válida.' })
  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } }); const user: unknown = await userResponse.json().catch(() => null); const userId = user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : ''
    if (!userResponse.ok || !userId) return json(401, { message: 'Sesión no válida.' })
    const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(userId)}&active=is.true&select=user_id`, { headers: headers(serviceKey) }); const profiles: unknown = await profileResponse.json().catch(() => null)
    if (!Array.isArray(profiles) || profiles.length !== 1) return json(403, { message: 'No tienes permiso para atender alertas.' })
    const updateResponse = await fetch(`${url}/rest/v1/whatsapp_staff_alerts?id=eq.${encodeURIComponent(alertId)}&status=eq.pending`, { method: 'PATCH', headers: headers(serviceKey, { Prefer: 'return=representation' }), body: JSON.stringify({ status: 'handled', handled_at: new Date().toISOString(), handled_by: userId }) }); const updated: unknown = await updateResponse.json().catch(() => null)
    if (!updateResponse.ok || !Array.isArray(updated) || updated.length !== 1) return json(409, { message: 'La alerta ya fue atendida o no está disponible.' })
    return json(200, { handled: true })
  } catch (error) { console.error('WhatsApp staff alert handling failed:', error); return json(500, { message: 'No se pudo atender la alerta.' }) }
}

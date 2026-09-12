const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const headers = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'return=minimal' })
const matchesToken = (provided: string, expected: string) => {
  if (provided.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const expectedToken = process.env.WHATSAPP_STAFF_ALERT_TOKEN
  const providedToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!expectedToken || !url || !serviceKey || !matchesToken(providedToken, expectedToken)) return json(401, { message: 'No autorizado.' })
  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const category = data?.category === 'help' || data?.category === 'pickup' ? data.category : ''
  const contactPhone = typeof data?.contactPhone === 'string' ? data.contactPhone.replace(/\D/g, '') : ''
  if (!category || contactPhone.length < 4 || contactPhone.length > 20) return json(400, { message: 'Alerta no válida.' })
  try {
    const response = await fetch(`${url}/rest/v1/whatsapp_staff_alerts`, { method: 'POST', headers: headers(serviceKey), body: JSON.stringify({ category, contact_phone: contactPhone }) })
    if (!response.ok) return json(502, { message: 'No se pudo guardar la alerta.' })
    return json(201, { created: true })
  } catch (error) { console.error('WhatsApp staff alert creation failed:', error); return json(500, { message: 'No se pudo guardar la alerta.' }) }
}

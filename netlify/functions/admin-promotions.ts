const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })

const getAdmin = async (request: Request) => {
  const authorization = request.headers.get('authorization')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!authorization?.startsWith('Bearer ') || !url || !key) return null
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } })
  if (!userResponse.ok) return null
  const user = await userResponse.json() as { id?: string }
  if (!user.id) return null
  const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=role,active`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const profiles = profileResponse.ok ? await profileResponse.json() as { role: string; active: boolean }[] : []
  return profiles.some((profile) => profile.active && profile.role === 'admin') ? { userId: user.id, url, key } : null
}

const normalizedCode = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : ''
const asDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : ''
const asPositiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Number.NaN
const asPositiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : Number.NaN

export default async (request: Request): Promise<Response> => {
  const admin = await getAdmin(request)
  if (!admin) return json(403, { message: 'Solo un administrador activo puede gestionar promociones.' })

  if (request.method === 'GET') {
    const response = await fetch(`${admin.url}/rest/v1/promotion_codes?select=id,code,discount_percent,minimum_subtotal,starts_at,expires_at,max_uses_per_customer,max_uses_total,status,audience,created_at&order=created_at.desc`, { headers: { apikey: admin.key, Authorization: `Bearer ${admin.key}` } })
    if (!response.ok) return json(500, { message: 'No fue posible cargar las promociones.' })
    return new Response(await response.text(), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } })
  }

  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}

  if (request.method === 'POST') {
    const code = normalizedCode(data.code)
    const discountPercent = asPositiveNumber(data.discountPercent)
    const minimumSubtotal = typeof data.minimumSubtotal === 'number' && Number.isFinite(data.minimumSubtotal) && data.minimumSubtotal >= 0 ? data.minimumSubtotal : Number.NaN
    const startsAt = asDate(data.startsAt)
    const expiresAt = asDate(data.expiresAt)
    const maxUsesPerCustomer = asPositiveInteger(data.maxUsesPerCustomer)
    const maxUsesTotal = data.maxUsesTotal === null || data.maxUsesTotal === undefined || data.maxUsesTotal === '' ? null : asPositiveInteger(data.maxUsesTotal)
    const status = data.status === 'active' ? 'active' : 'draft'
    if (!/^[A-Z0-9_-]{3,32}$/.test(code) || discountPercent > 100 || !Number.isFinite(minimumSubtotal) || !startsAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(startsAt) || !Number.isFinite(maxUsesPerCustomer) || (maxUsesTotal !== null && !Number.isFinite(maxUsesTotal))) return json(400, { message: 'Revisa los datos de la promoción.' })
    const response = await fetch(`${admin.url}/rest/v1/promotion_codes`, {
      method: 'POST', headers: { apikey: admin.key, Authorization: `Bearer ${admin.key}`, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ code, discount_percent: discountPercent, minimum_subtotal: minimumSubtotal, starts_at: startsAt, expires_at: expiresAt, max_uses_per_customer: maxUsesPerCustomer, max_uses_total: maxUsesTotal, status, audience: 'public', created_by: admin.userId }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) return json(response.status === 409 ? 409 : 500, { message: response.status === 409 ? 'Ya existe una promoción con ese código.' : 'No fue posible crear la promoción.' })
    return json(201, { promotion: Array.isArray(result) ? result[0] : result })
  }

  if (request.method === 'PATCH') {
    const id = typeof data.id === 'string' ? data.id : ''
    const status = data.status === 'active' || data.status === 'paused' ? data.status : ''
    if (!id || !status) return json(400, { message: 'Cambio de estado no válido.' })
    const response = await fetch(`${admin.url}/rest/v1/promotion_codes?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { apikey: admin.key, Authorization: `Bearer ${admin.key}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    })
    return response.ok ? json(200, { status }) : json(500, { message: 'No fue posible actualizar la promoción.' })
  }

  return json(405, { message: 'Método no permitido.' })
}

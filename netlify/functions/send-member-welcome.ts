import { sendMemberPromotionEmail } from '../lib/member-promotions'
import { json } from '../lib/request'

const isActiveStaff = async (request: Request) => {
  const authorization = request.headers.get('authorization')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!authorization?.startsWith('Bearer ') || !url || !key) return false
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } })
  const user = userResponse.ok ? await userResponse.json() as { id?: string } : null
  if (!user?.id) return false
  const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=role,active`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const profiles = profileResponse.ok ? await profileResponse.json() as { role: string; active: boolean }[] : []
  return profiles.some((profile) => profile.active && ['staff', 'manager', 'admin'].includes(profile.role))
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  if (!await isActiveStaff(request)) return json(403, { message: 'No tienes permiso para enviar este beneficio.' })
  const body: unknown = await request.json().catch(() => null)
  const memberId = body && typeof body === 'object' && typeof (body as Record<string, unknown>).memberId === 'string' ? (body as Record<string, string>).memberId : ''
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json(400, { message: 'Socio no válido.' })
  try {
    await sendMemberPromotionEmail(memberId, 'welcome')
    return json(200, { sent: true })
  } catch (error) {
    console.error('Member welcome email failed:', error instanceof Error ? error.message : 'unknown')
    return json(502, { message: 'El socio fue creado, pero no pudimos enviar su código por email.' })
  }
}

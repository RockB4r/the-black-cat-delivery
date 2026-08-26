import { clearSessionCookie, readMemberSession, serverHeaders } from '../lib/member-portal'
import { json } from '../lib/request'

type Member = { full_name: string; points_balance: number; status: string }
type Consumption = { consumed_at: string; amount: number; points_earned: number }
type Activity = { created_at: string; movement_type: string; points: number }

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json(405, { message: 'Método no permitido.' })
  const session = await readMemberSession(request)
  if (!session) return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': clearSessionCookie(request) } })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return json(500, { message: 'La consulta no está disponible temporalmente.' })
  try {
    const memberResponse = await fetch(`${url}/rest/v1/members?id=eq.${encodeURIComponent(session.memberId)}&status=eq.active&select=full_name,points_balance,status&limit=1`, { headers: serverHeaders(key) })
    const members: unknown = await memberResponse.json().catch(() => null)
    const member = Array.isArray(members) && members[0] && typeof members[0] === 'object' ? members[0] as Member : null
    if (!memberResponse.ok || !member) return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': clearSessionCookie(request) } })
    const [consumptionsResponse, activitiesResponse] = await Promise.all([
      fetch(`${url}/rest/v1/consumptions?member_id=eq.${encodeURIComponent(session.memberId)}&status=eq.active&select=consumed_at,amount,points_earned&order=consumed_at.desc&limit=5`, { headers: serverHeaders(key) }),
      fetch(`${url}/rest/v1/point_movements?member_id=eq.${encodeURIComponent(session.memberId)}&select=created_at,movement_type,points&order=created_at.desc&limit=5`, { headers: serverHeaders(key) }),
    ])
    const consumptions = await consumptionsResponse.json().catch(() => []) as Consumption[]
    const activities = await activitiesResponse.json().catch(() => []) as Activity[]
    if (!consumptionsResponse.ok || !activitiesResponse.ok) throw new Error('Member activity query failed.')
    return json(200, { authenticated: true, member: { firstName: member.full_name.trim().split(/\s+/)[0] || 'Member', pointsBalance: Number(member.points_balance) || 0 }, consumptions: Array.isArray(consumptions) ? consumptions.map((item) => ({ date: item.consumed_at, amount: Number(item.amount), pointsEarned: Number(item.points_earned) })) : [], activities: Array.isArray(activities) ? activities.map((item) => ({ date: item.created_at, type: item.movement_type, points: Number(item.points) })) : [] })
  } catch (error) {
    console.error('Member portal session query failed:', error)
    return json(500, { message: 'No pudimos cargar tus puntos. Inténtalo nuevamente.' })
  }
}

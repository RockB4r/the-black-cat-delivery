import { clearLoginLimit, checkLoginLimit, createMemberSession, recordFailedLogin, serverHeaders, sessionCookie } from '../lib/member-portal'
import { json } from '../lib/request'

type MemberLoginRecord = { id: string; phone: string | null }

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const limit = await checkLoginLimit(request)
  if (!limit.allowed) return json(429, { message: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' })
  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const documentType = data?.document_type === 'DNI' || data?.document_type === 'CE' ? data.document_type : ''
  const documentNumber = typeof data?.document_number === 'string' ? data.document_number.replace(/\D/g, '') : ''
  const phoneLast4 = typeof data?.phone_last4 === 'string' ? data.phone_last4.replace(/\D/g, '') : ''
  const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(documentNumber) : documentType === 'CE' ? /^\d{9,11}$/.test(documentNumber) : false
  if (!validDocument || !/^\d{4}$/.test(phoneLast4)) return json(400, { message: 'Revisa el documento y los últimos 4 dígitos de tu celular.' })

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('Member portal server environment is incomplete.'); return json(500, { message: 'La consulta no está disponible temporalmente.' }) }
  try {
    const response = await fetch(`${url}/rest/v1/members?document_type=eq.${documentType}&document_number=eq.${encodeURIComponent(documentNumber)}&status=eq.active&select=id,phone&limit=1`, { headers: serverHeaders(key) })
    const records: unknown = await response.json().catch(() => null)
    const member = Array.isArray(records) && records[0] && typeof records[0] === 'object' ? records[0] as MemberLoginRecord : null
    const phoneDigits = member?.phone?.replace(/\D/g, '') ?? ''
    if (!response.ok || !member || phoneDigits.slice(-4) !== phoneLast4) {
      await recordFailedLogin(limit.key)
      return json(401, { message: 'No pudimos validar esos datos. Revisa la información e inténtalo nuevamente.' })
    }
    const sessionId = await createMemberSession(member.id)
    await clearLoginLimit(limit.key)
    return new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': sessionCookie(request, sessionId) } })
  } catch (error) {
    console.error('Member portal login failed:', error)
    return json(500, { message: 'La consulta no está disponible temporalmente.' })
  }
}

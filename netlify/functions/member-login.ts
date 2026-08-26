import { clearLoginLimit, checkLoginLimit, createMemberSession, normalizeDocument, normalizePhone, recordFailedLogin, serverHeaders, sessionCookie } from '../lib/member-portal'
import { json } from '../lib/request'

type MemberLoginRecord = { id: string; document_number: string | null; dni: string | null; phone: string | null; status: string | null }

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const limit = await checkLoginLimit(request)
  if (!limit.allowed) return json(429, { message: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' })
  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const documentType = data?.document_type === 'DNI' || data?.document_type === 'CE' ? data.document_type : ''
  const documentNumber = normalizeDocument(typeof data?.document_number === 'string' ? data.document_number : '')
  const phoneLast4 = normalizePhone(typeof data?.phone_last4 === 'string' ? data.phone_last4 : '')
  const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(documentNumber) : documentType === 'CE' ? /^\d{9,11}$/.test(documentNumber) : false
  if (!validDocument || !/^\d{4}$/.test(phoneLast4)) return json(400, { message: 'No pudimos validar tus datos. Revisa tu documento y los últimos 4 dígitos de tu celular.' })

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('Member portal server environment is incomplete.'); return json(500, { message: 'La consulta no está disponible temporalmente.' }) }
  try {
    const legacyFilter = documentType === 'DNI' ? `,dni.ilike.*${documentNumber}*` : ''
    const response = await fetch(`${url}/rest/v1/members?document_type=eq.${documentType}&or=(document_number.ilike.*${documentNumber}*${legacyFilter})&select=id,document_number,dni,phone,status`, { headers: serverHeaders(key) })
    const records: unknown = await response.json().catch(() => null)
    const candidates = Array.isArray(records) ? records.filter((item): item is MemberLoginRecord => item !== null && typeof item === 'object' && 'id' in item && 'document_number' in item && 'dni' in item && 'phone' in item && 'status' in item) : []
    const member = candidates.find((item) => normalizeDocument(item.document_number) === documentNumber || (documentType === 'DNI' && normalizeDocument(item.dni) === documentNumber)) ?? null
    const documentMatched = Boolean(member)
    const phoneMatched = Boolean(member && normalizePhone(member.phone).slice(-4) === phoneLast4)
    const statusMatched = member?.status === 'active'
    console.info('Member portal login diagnostics', { memberFound: Boolean(member), documentMatched, phoneLast4Matched: phoneMatched, statusMatched })
    if (!response.ok || !member || !phoneMatched || !statusMatched) {
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

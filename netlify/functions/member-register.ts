import { checkRegistrationLimit, clearRegistrationLimit, normalizeDocument, normalizePeruvianPhone, recordFailedRegistration, serverHeaders } from '../lib/member-portal'
import { json } from '../lib/request'
import { sendMemberPromotionEmail } from '../lib/member-promotions'

type MemberCandidate = {
  id: string
  document_type: string | null
  document_number: string | null
  dni: string | null
  phone: string | null
  email: string | null
}

const validEmail = (value: string) => /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/.test(value)
const validBirthDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value <= new Date().toISOString().slice(0, 10)
const duplicateMessage = 'Ya existe una membresía asociada a estos datos. Puedes consultar tus puntos aquí.'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })

  const limit = await checkRegistrationLimit(request)
  if (!limit.allowed) return json(429, { message: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' })

  const body: unknown = await request.json().catch(() => null)
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const firstName = typeof data?.first_name === 'string' ? data.first_name.trim().replace(/\s+/g, ' ') : ''
  const lastName = typeof data?.last_name === 'string' ? data.last_name.trim().replace(/\s+/g, ' ') : ''
  const documentType = data?.document_type === 'DNI' || data?.document_type === 'CE' ? data.document_type : ''
  const documentNumber = normalizeDocument(typeof data?.document_number === 'string' ? data.document_number : '')
  const phone = normalizePeruvianPhone(typeof data?.phone === 'string' ? data.phone : '')
  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : ''
  const birthDate = typeof data?.birth_date === 'string' ? data.birth_date : ''
  const termsAccepted = data?.terms_accepted === true
  const marketingConsent = data?.marketing_consent === true
  const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(documentNumber) : documentType === 'CE' ? /^\d{9,11}$/.test(documentNumber) : false

  if (!firstName || !lastName || !validDocument || !phone || !validEmail(email) || !validBirthDate(birthDate) || !termsAccepted) {
    await recordFailedRegistration(limit.key)
    return json(400, { message: 'Revisa los datos obligatorios e inténtalo nuevamente.' })
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Member registration server environment is incomplete.')
    return json(500, { message: 'El registro no está disponible temporalmente.' })
  }

  try {
    const filters = [
      `and(document_type.eq.${documentType},document_number.eq.${documentNumber})`,
      documentType === 'DNI' ? `dni.eq.${documentNumber}` : '',
      `email.ilike.${email}`,
      `phone.ilike.*${phone.slice(-4)}`,
    ].filter(Boolean)
    const candidatesUrl = new URL('/rest/v1/members', url)
    candidatesUrl.searchParams.set('select', 'id,document_type,document_number,dni,phone,email')
    candidatesUrl.searchParams.set('or', `(${filters.join(',')})`)
    const candidatesResponse = await fetch(candidatesUrl, { headers: serverHeaders(key) })
    const candidatesData: unknown = await candidatesResponse.json().catch(() => null)
    const candidates = Array.isArray(candidatesData) ? candidatesData.filter((item): item is MemberCandidate => item !== null && typeof item === 'object' && 'id' in item) : []
    const duplicate = candidates.some((candidate) => {
      const sameDocument = normalizeDocument(candidate.document_number) === documentNumber || (documentType === 'DNI' && normalizeDocument(candidate.dni) === documentNumber)
      const samePhone = normalizePeruvianPhone(candidate.phone) === phone
      const sameEmail = typeof candidate.email === 'string' && candidate.email.trim().toLowerCase() === email
      return sameDocument || samePhone || sameEmail
    })
    if (!candidatesResponse.ok) throw new Error('Member duplicate check failed.')
    if (duplicate) {
      await recordFailedRegistration(limit.key)
      return json(409, { duplicate: true, message: duplicateMessage })
    }

    const insertResponse = await fetch(new URL('/rest/v1/members', url), {
      method: 'POST',
      headers: serverHeaders(key, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        document_type: documentType,
        document_number: documentNumber,
        dni: documentType === 'DNI' ? documentNumber : null,
        full_name: `${firstName} ${lastName}`,
        phone,
        email,
        birth_date: birthDate,
        status: 'active',
        marketing_consent: marketingConsent,
        marketing_consent_at: marketingConsent ? new Date().toISOString() : null,
      }),
    })
    const inserted: unknown = await insertResponse.json().catch(() => null)
    if (!insertResponse.ok) {
      const error = inserted as { code?: string } | null
      if (error?.code === '23505') return json(409, { duplicate: true, message: duplicateMessage })
      throw new Error('Member creation failed.')
    }

    const memberId = Array.isArray(inserted) && inserted[0] && typeof inserted[0] === 'object' && typeof (inserted[0] as { id?: unknown }).id === 'string' ? (inserted[0] as { id: string }).id : ''
    if (!memberId) throw new Error('Member creation did not return an identifier.')
    let welcomeEmailSent = false
    try { welcomeEmailSent = await sendMemberPromotionEmail(memberId, 'welcome') === 'sent' } catch (error) { console.error('Welcome promotion email failed:', error instanceof Error ? error.message : 'unknown') }
    await clearRegistrationLimit(limit.key)
    return json(201, { created: true, welcomeEmailSent })
  } catch (error) {
    console.error('Member registration failed:', error instanceof Error ? error.message : 'unknown error')
    return json(500, { message: 'No pudimos crear tu membresía. Inténtalo nuevamente.' })
  }
}

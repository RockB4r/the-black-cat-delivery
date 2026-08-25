type ComplaintInput = {
  documentType: 'DNI' | 'CE'
  documentNumber: string
  firstName: string
  lastName: string
  email: string
  phone: string
  orderNumber?: string
  purchaseDate?: string
  amount?: string
  type: 'reclamo' | 'queja'
  description: string
  consumerRequest: string
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

const parseInput = (body: unknown): ComplaintInput | null => {
  if (!body || typeof body !== 'object') return null
  const data = body as Record<string, unknown>
  const documentType = data.documentType === 'DNI' || data.documentType === 'CE' ? data.documentType : null
  const documentNumber = text(data.documentNumber, 11).replace(/\D/g, '')
  const firstName = text(data.firstName, 120); const lastName = text(data.lastName, 120); const email = text(data.email, 254).toLowerCase(); const phone = text(data.phone, 40)
  const type = data.type === 'reclamo' || data.type === 'queja' ? data.type : null
  const description = text(data.description, 5000); const consumerRequest = text(data.consumerRequest, 3000)
  const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(documentNumber) : documentType === 'CE' && /^\d{9,11}$/.test(documentNumber)
  const purchaseDate = text(data.purchaseDate, 10); const rawAmount = text(data.amount, 20); const amount = rawAmount === '' ? undefined : Number(rawAmount)
  if (!documentType || !validDocument || !firstName || !lastName || !emailPattern.test(email) || !phone || !type || !description || !consumerRequest || (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) || (amount !== undefined && (!Number.isFinite(amount) || amount < 0))) return null
  return { documentType, documentNumber, firstName, lastName, email, phone, orderNumber: text(data.orderNumber, 80) || undefined, purchaseDate: purchaseDate || undefined, amount: rawAmount || undefined, type, description, consumerRequest }
}

const sendEmail = async (apiKey: string, from: string, to: string, subject: string, content: string) => {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text: content }) })
  if (!response.ok) throw new Error(`Resend returned ${response.status}.`)
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { message: 'Método no permitido.' })
  const input = parseInput(await request.json().catch(() => null))
  if (!input) return json(400, { message: 'Completa los campos obligatorios con datos válidos.' })
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) { console.error('Complaints database environment is incomplete.'); return json(500, { message: 'El Libro de Reclamaciones no está disponible temporalmente.' }) }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/complaints`, { method: 'POST', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ type: input.type, document_type: input.documentType, document_number: input.documentNumber, first_name: input.firstName, last_name: input.lastName, email: input.email, phone: input.phone, order_number: input.orderNumber ?? null, purchase_date: input.purchaseDate ?? null, amount: input.amount === undefined ? null : Number(input.amount), description: input.description, consumer_request: input.consumerRequest }) })
    const created: unknown = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(created) || !created[0] || typeof created[0] !== 'object' || !('complaint_number' in created[0]) || typeof created[0].complaint_number !== 'string') { console.error('Complaint creation failed:', response.status); return json(500, { message: 'No fue posible registrar tu reclamación. Inténtalo nuevamente.' }) }
    const complaint = created[0] as { complaint_number: string; created_at: string }
    const apiKey = process.env.RESEND_API_KEY; const internalRecipient = process.env.COMPLAINT_NOTIFICATION_EMAIL; const from = process.env.ORDER_NOTIFICATION_FROM_EMAIL
    if (!apiKey || !internalRecipient || !from) console.error(`Complaint ${complaint.complaint_number} registered without complete email configuration.`)
    else {
      const details = [`Número de reclamación: ${complaint.complaint_number}`, `Fecha: ${complaint.created_at}`, '', `Consumidor: ${input.firstName} ${input.lastName}`, `Documento: ${input.documentType} ${input.documentNumber}`, `Correo: ${input.email}`, `Teléfono: ${input.phone}`, `Tipo: ${input.type}`, `Pedido: ${input.orderNumber || 'No proporcionado'}`, `Fecha de compra: ${input.purchaseDate || 'No proporcionada'}`, `Monto pagado: ${input.amount === undefined ? 'No proporcionado' : `S/ ${Number(input.amount).toFixed(2)}`}`, '', 'Descripción:', input.description, '', 'Solicitud del consumidor:', input.consumerRequest].join('\n')
      const results = await Promise.allSettled([sendEmail(apiKey, from, internalRecipient, `Nuevo Libro de Reclamaciones - ${complaint.complaint_number}`, details), sendEmail(apiKey, from, input.email, 'Confirmación de Libro de Reclamaciones - The Black Cat', `Hemos registrado tu comunicación.\n\n${details}`)])
      results.forEach((result) => { if (result.status === 'rejected') console.error(`Complaint email failed for ${complaint.complaint_number}:`, result.reason) })
    }
    return json(201, { complaintNumber: complaint.complaint_number, createdAt: complaint.created_at })
  } catch (error) { console.error('Complaint registration failed:', error); return json(500, { message: 'No fue posible registrar tu reclamación. Inténtalo nuevamente.' }) }
}

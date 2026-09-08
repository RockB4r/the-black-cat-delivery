import ExcelJS from 'exceljs'
import type { Member } from '../../src/staff/types'

const json = (status: number, message: string) => new Response(JSON.stringify({ message }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
})
const memberFields = 'id,document_type,document_number,dni,full_name,phone,email,birth_date,joined_at,points_balance,status,marketing_consent'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json(405, 'Método no permitido.')
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return json(401, 'Inicia sesión para exportar socios.')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return json(503, 'La exportación no está disponible. Intenta más tarde.')

  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } })
    if (!userResponse.ok) return json(401, 'Tu sesión expiró. Vuelve a iniciar sesión.')
    const user = await userResponse.json() as { id?: string }
    if (typeof user.id !== 'string') return json(401, 'Sesión no válida.')
    const headers = { apikey: key, Authorization: authorization }
    const profileResponse = await fetch(`${url}/rest/v1/staff_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=role,active`, { headers })
    if (!profileResponse.ok) throw new Error('Unable to verify export permissions')
    const profiles = await profileResponse.json() as { role: string; active: boolean }[]
    if (!profiles.some((profile) => profile.role === 'admin' && profile.active === true)) {
      return json(403, 'Solo los administradores activos pueden exportar socios.')
    }

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'The Black Cat'
    const sheet = workbook.addWorksheet('Socios', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = [
      { header: 'Nombre completo', width: 36 }, { header: 'Tipo de documento', width: 20 },
      { header: 'Documento', width: 20 }, { header: 'Teléfono', width: 20 },
      { header: 'Email', width: 36 }, { header: 'Fecha de nacimiento', width: 23 },
      { header: 'Registro (Lima)', width: 24 }, { header: 'Puntos', width: 12 },
      { header: 'Estado', width: 18 }, { header: 'Acepta comunicaciones', width: 27 },
    ]
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF242018' } }
    sheet.getRow(1).height = 26
    sheet.getColumn(3).numFmt = '@'
    sheet.getColumn(4).numFmt = '@'
    const dateFormat = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
    const startedAt = new Date().toISOString()
    let lastId = ''
    // Keyset pagination also works when Supabase caps pages below the requested limit.
    while (true) {
      const query = new URLSearchParams({ select: memberFields, order: 'id.asc', limit: '1000', created_at: `lte.${startedAt}` })
      if (lastId) query.set('id', `gt.${lastId}`)
      const response = await fetch(`${url}/rest/v1/members?${query}`, { headers })
      if (!response.ok) throw new Error('Unable to read members for export')
      const members = await response.json() as Member[]
      if (!members.length) break
      for (const member of members) {
        // Strings are written as text, never as formulas; preserve leading document zeros.
        sheet.addRow([
          member.full_name, member.document_type || 'DNI', member.document_number || member.dni || '',
          member.phone || '', member.email || '', member.birth_date || '',
          member.joined_at ? dateFormat.format(new Date(member.joined_at)) : '', member.points_balance,
          member.status, member.marketing_consent ? 'Sí' : 'No',
        ])
      }
      const nextId = members[members.length - 1].id
      if (!nextId || nextId === lastId) throw new Error('Member pagination did not advance')
      lastId = nextId
    }
    sheet.autoFilter = { from: 'A1', to: 'J1' }
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="socios-black-cat-${startedAt.slice(0, 10)}.xlsx"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    // Do not log personal data or session tokens.
    return json(500, 'No se pudo exportar la lista completa. Intenta nuevamente.')
  }
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Consumption = { date: string; amount: number; pointsEarned: number }
type Activity = { date: string; type: string; points: number }
type MemberData = { firstName: string; pointsBalance: number }
type SessionResponse = { authenticated: boolean; member?: MemberData; consumptions?: Consumption[]; activities?: Activity[]; message?: string }

const formatDate = (date: string) => new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
const money = (amount: number) => `S/ ${amount.toFixed(2)}`

export function MemberPortal() {
  const [documentType, setDocumentType] = useState<'DNI' | 'CE'>('DNI')
  const [documentNumber, setDocumentNumber] = useState('')
  const [phoneLast4, setPhoneLast4] = useState('')
  const [member, setMember] = useState<MemberData | null>(null)
  const [consumptions, setConsumptions] = useState<Consumption[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const loadSession = async () => {
    try {
      const response = await fetch('/.netlify/functions/member-session', { credentials: 'same-origin' })
      const result = await response.json() as SessionResponse
      if (!response.ok || !result.authenticated || !result.member) { setMember(null); return }
      setMember(result.member); setConsumptions(result.consumptions ?? []); setActivities(result.activities ?? [])
    } catch { setMessage('No pudimos conectar con la consulta de puntos.') } finally { setLoading(false) }
  }

  useEffect(() => { void loadSession() }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage('')
    const document = documentNumber.replace(/\D/g, '')
    const phone = phoneLast4.replace(/\D/g, '')
    const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(document) : /^\d{9,11}$/.test(document)
    if (!validDocument || !/^\d{4}$/.test(phone)) { setMessage(documentType === 'DNI' ? 'Ingresa un DNI válido de 8 dígitos y los últimos 4 dígitos de tu celular.' : 'Ingresa un CE válido de 9 a 11 dígitos y los últimos 4 dígitos de tu celular.'); return }
    setSubmitting(true)
    try {
      const response = await fetch('/.netlify/functions/member-login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document_type: documentType, document_number: document, phone_last4: phone }) })
      const result = await response.json() as { authenticated?: boolean; message?: string }
      if (!response.ok || !result.authenticated) { setMessage(result.message ?? 'No pudimos validar esos datos.'); return }
      setLoading(true); await loadSession()
    } catch { setMessage('No pudimos conectar con la consulta de puntos.') } finally { setSubmitting(false) }
  }

  const logout = async () => {
    await fetch('/.netlify/functions/member-logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
    setMember(null); setConsumptions([]); setActivities([]); setDocumentNumber(''); setPhoneLast4(''); setMessage('Sesión cerrada correctamente.')
  }

  if (loading) return <main className="app-shell member-portal-page"><p className="member-loading">Cargando tu portal de socios...</p></main>
  return <main className="app-shell member-portal-page"><header className="topbar"><a className="brand" href="/" aria-label="Volver a The Black Cat"><span className="brand-mark" aria-hidden="true">✦</span><span><strong>THE BLACK CAT</strong><small>ROCK BAR</small></span></a></header><section className="member-portal-content">{member ? <MemberDashboard member={member} consumptions={consumptions} activities={activities} onLogout={logout} /> : <section className="member-login-card"><p className="eyebrow">BLACK CAT MEMBER</p><h1>Consulta tus puntos</h1><p>Ingresa tus datos para conocer tu saldo y actividad reciente.</p><form onSubmit={submit}><label>Tipo de documento<select value={documentType} onChange={(event) => { setDocumentType(event.target.value as 'DNI' | 'CE'); setDocumentNumber('') }}><option value="DNI">DNI</option><option value="CE">Carné de Extranjería (CE)</option></select></label><label>Número de documento<input inputMode="numeric" maxLength={documentType === 'DNI' ? 8 : 11} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value.replace(/\D/g, ''))} placeholder={documentType === 'DNI' ? '8 dígitos' : '9 a 11 dígitos'} required /></label><label>Últimos 4 dígitos de tu celular<input inputMode="numeric" maxLength={4} value={phoneLast4} onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, ''))} placeholder="1234" required /></label>{message && <p className="member-message" role="alert">{message}</p>}<button className="checkout-button" disabled={submitting}>{submitting ? 'Consultando...' : 'Consultar mis puntos'}</button></form></section>}</section><footer><span>THE BLACK CAT · ROCK BAR</span><div className="footer-links"><a href="/">Pedir delivery</a><a href="/libro-de-reclamaciones">Libro de Reclamaciones</a></div><span>Black Cat Member</span></footer></main>
}

function MemberDashboard({ member, consumptions, activities, onLogout }: { member: MemberData; consumptions: Consumption[]; activities: Activity[]; onLogout: () => void }) {
  const remaining = Math.max(0, 20 - member.pointsBalance)
  return <section className="member-dashboard"><div className="member-dashboard-heading"><div><p className="eyebrow">BLACK CAT MEMBER</p><h1>Hola, {member.firstName}</h1></div><button className="staff-secondary" type="button" onClick={onLogout}>Cerrar sesión</button></div><section className="member-points-card"><p>BLACK CAT MEMBER</p><strong>{member.pointsBalance} <span>/ 20 puntos</span></strong>{member.pointsBalance >= 20 ? <b>¡Beneficio disponible!</b> : <span>Te faltan {remaining} puntos para desbloquear tu beneficio.</span>}<small>Cada 20 puntos puedes canjear un producto según las reglas del programa.</small></section><section className="member-activity-section"><h2>Últimos consumos</h2>{consumptions.length ? <ul>{consumptions.map((item) => <li key={`${item.date}-${item.amount}`}><time>{formatDate(item.date)}</time><strong>{money(item.amount)}</strong><span>+{item.pointsEarned} puntos</span></li>)}</ul> : <p>Aún no registras consumos activos.</p>}</section><section className="member-activity-section"><h2>Actividad reciente</h2>{activities.length ? <ul>{activities.map((item) => <li key={`${item.date}-${item.type}-${item.points}`}><time>{formatDate(item.date)}</time><strong>{item.points > 0 ? 'Puntos ganados' : 'Canje de beneficio'}</strong><span className={item.points > 0 ? 'points-positive' : 'points-negative'}>{item.points > 0 ? '+' : ''}{item.points} puntos</span></li>)}</ul> : <p>Aún no hay movimientos para mostrar.</p>}</section></section>
}

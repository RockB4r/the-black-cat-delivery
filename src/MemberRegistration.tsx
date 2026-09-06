import { useState } from 'react'
import type { FormEvent } from 'react'

const validEmail = (value: string) => /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/.test(value)
const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '')
  if (/^51\d{9}$/.test(digits)) return digits.slice(2)
  return /^9\d{8}$/.test(digits) ? digits : ''
}

export function MemberRegistration() {
  const [documentType, setDocumentType] = useState<'DNI' | 'CE'>('DNI')
  const [documentNumber, setDocumentNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    const formData = new FormData(event.currentTarget)
    const firstName = String(formData.get('firstName') ?? '').trim()
    const lastName = String(formData.get('lastName') ?? '').trim()
    const document = documentNumber.replace(/\D/g, '')
    const normalizedPhone = normalizePhone(phone)
    const normalizedEmail = email.trim().toLowerCase()
    const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(document) : /^\d{9,11}$/.test(document)
    if (!firstName || !lastName || !validDocument || !normalizedPhone || !validEmail(normalizedEmail) || !birthDate || birthDate > new Date().toISOString().slice(0, 10) || !termsAccepted) {
      setMessage('Completa los datos obligatorios. Usa un teléfono peruano válido y una fecha de cumpleaños no futura.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/.netlify/functions/member-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, document_type: documentType, document_number: document, phone: normalizedPhone, email: normalizedEmail, birth_date: birthDate, terms_accepted: termsAccepted, marketing_consent: marketingConsent }),
      })
      const result = await response.json() as { created?: boolean; message?: string }
      if (!response.ok || !result.created) {
        setMessage(result.message || 'No pudimos crear tu membresía. Inténtalo nuevamente.')
        return
      }
      setCreated(true)
    } catch {
      setMessage('No pudimos conectar con el registro de socios. Inténtalo nuevamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="app-shell member-portal-page"><header className="topbar"><a className="brand" href="/" aria-label="Volver a The Black Cat"><span className="brand-mark" aria-hidden="true">✦</span><span><strong>THE BLACK CAT</strong><small>ROCK BAR</small></span></a></header><section className="member-portal-content">{created ? <section className="member-registration-success" role="status"><span aria-hidden="true">🐈‍⬛</span><p className="eyebrow">BLACK CAT MEMBER</p><h1>¡Ya eres Black Cat Member!</h1><p>Desde ahora acumulas 2 puntos por cada S/ 30 de consumo.</p><p>Al llegar a 20 puntos podrás canjear un producto gratis entre las opciones disponibles.</p><p>Ya puedes realizar tu pedido y empezar a acumular puntos.</p><div className="member-registration-actions"><a className="checkout-button" href="/">Comprar ahora</a><a className="back-button" href="/socios">Consultar mis puntos</a></div></section> : <section className="member-login-card member-registration-card"><p className="eyebrow">BLACK CAT MEMBER</p><h1>Hazte Socio</h1><p>Regístrate y empieza a acumular puntos con tus consumos en The Black Cat.</p><form onSubmit={submit}><div className="member-registration-grid"><label>Nombre<input name="firstName" autoComplete="given-name" required /></label><label>Apellido<input name="lastName" autoComplete="family-name" required /></label></div><label>Tipo de documento<select value={documentType} onChange={(event) => { setDocumentType(event.target.value as 'DNI' | 'CE'); setDocumentNumber('') }}><option value="DNI">DNI</option><option value="CE">Carné de Extranjería (CE)</option></select></label><label>Número de documento<input inputMode="numeric" maxLength={documentType === 'DNI' ? 8 : 11} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value.replace(/\D/g, ''))} placeholder={documentType === 'DNI' ? '8 dígitos' : '9 a 11 dígitos'} required /></label><label>Teléfono<input inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="999 999 999 o +51 999 999 999" required /></label><label>Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@email.com" required /></label><label>Fecha de cumpleaños<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} required /></label><label className="member-consent"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required /> <span>He leído y acepto la <a href="/privacy">Política de Privacidad</a> y los <a href="/terminos-y-condiciones">términos del Black Cat Member Club</a>.</span></label><label className="member-consent"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /> <span>Quiero recibir promociones, descuentos y novedades de The Black Cat.</span></label>{message && <p className="member-message" role="alert">{message}</p>}<button className="checkout-button" disabled={submitting}>{submitting ? 'Creando membresía...' : 'Hazte Socio'}</button><a className="member-registration-login-link" href="/socios">¿Ya eres socio? Consulta tus puntos aquí.</a></form></section>}</section><footer><span>THE BLACK CAT · ROCK BAR</span><div className="footer-links"><a href="/socios">Consulta tus puntos</a><a href="/privacy">Política de Privacidad</a></div><span>Black Cat Member</span></footer></main>
}

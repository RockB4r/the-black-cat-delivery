import { useState } from 'react'
import type { FormEvent } from 'react'

type ComplaintResult = { complaintNumber: string; createdAt: string }

export function ComplaintsBook() {
  const [documentType, setDocumentType] = useState<'DNI' | 'CE'>('DNI')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<ComplaintResult | null>(null)

  const submitComplaint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      documentType,
      documentNumber: String(form.get('documentNumber') ?? '').replace(/\D/g, ''),
      firstName: String(form.get('firstName') ?? '').trim(),
      lastName: String(form.get('lastName') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim(),
      orderNumber: String(form.get('orderNumber') ?? '').trim(),
      purchaseDate: String(form.get('purchaseDate') ?? ''),
      amount: String(form.get('amount') ?? '').trim(),
      type: String(form.get('type') ?? 'reclamo'),
      description: String(form.get('description') ?? '').trim(),
      consumerRequest: String(form.get('consumerRequest') ?? '').trim(),
    }
    const validDocument = documentType === 'DNI' ? /^\d{8}$/.test(payload.documentNumber) : /^\d{9,11}$/.test(payload.documentNumber)
    if (!validDocument) { setMessage(documentType === 'DNI' ? 'Ingresa un DNI válido de 8 dígitos.' : 'Ingresa un Carné de Extranjería válido de 9 a 11 dígitos.'); return }
    setSubmitting(true); setMessage('')
    try {
      const response = await fetch('/.netlify/functions/create-complaint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok || !data || typeof data !== 'object' || !('complaintNumber' in data) || typeof data.complaintNumber !== 'string') {
        setMessage(data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : 'No fue posible registrar tu reclamación. Inténtalo nuevamente.')
        return
      }
      setResult({ complaintNumber: data.complaintNumber, createdAt: 'createdAt' in data && typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString() })
    } catch { setMessage('No fue posible conectar con el Libro de Reclamaciones. Inténtalo nuevamente.') } finally { setSubmitting(false) }
  }

  return <main className="app-shell complaints-book-page"><header className="topbar"><a className="brand" href="/" aria-label="Volver a The Black Cat"><span className="brand-mark" aria-hidden="true">✦</span><span><strong>THE BLACK CAT</strong><small>ROCK BAR</small></span></a></header><section className="complaints-book-content complaints-form-content"><p className="eyebrow">LIBRO DE RECLAMACIONES VIRTUAL</p><div className="complaints-book-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4.75A2.75 2.75 0 0 1 7.75 2H20v16H7.75A2.75 2.75 0 0 0 5 20.75m0-16v16m0-16A2.75 2.75 0 0 1 7.75 2H20M9 6h7m-7 4h7m-7 4h4" /></svg></div><h1>Libro de Reclamaciones</h1><div className="complaints-provider"><strong>HERITAGE GROUP S.A.C.</strong><span>RUC: 20610407499</span><span>The Black Cat – Rock Bar</span><span>Grau 184, Barranca, Perú</span><a href="mailto:reclamos@theblackcatrockbar.com">reclamos@theblackcatrockbar.com</a></div>{result ? <section className="complaint-success" role="status"><span aria-hidden="true">✓</span><h2>Su reclamación ha sido registrada correctamente.</h2><p>Número de reclamación:</p><strong>{result.complaintNumber}</strong><p>También enviamos una copia de la información registrada a tu correo electrónico.</p><a className="back-button complaints-book-back" href="/">← Volver al inicio</a></section> : <form className="complaints-form" onSubmit={submitComplaint}><fieldset><legend>A) Datos del consumidor</legend><div className="complaints-grid"><label>Tipo de documento<select value={documentType} onChange={(event) => setDocumentType(event.target.value as 'DNI' | 'CE')}><option value="DNI">DNI</option><option value="CE">Carné de Extranjería (CE)</option></select></label><label>Número de documento<input name="documentNumber" inputMode="numeric" maxLength={documentType === 'DNI' ? 8 : 11} onChange={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '') }} placeholder={documentType === 'DNI' ? '8 dígitos' : '9 a 11 dígitos'} required /></label><label>Nombres<input name="firstName" autoComplete="given-name" required /></label><label>Apellidos<input name="lastName" autoComplete="family-name" required /></label><label>Correo electrónico<input name="email" type="email" autoComplete="email" required /></label><label>Teléfono<input name="phone" inputMode="tel" autoComplete="tel" required /></label></div></fieldset><fieldset><legend>B) Identificación del servicio</legend><div className="complaints-grid"><label>Número de pedido <small>Opcional</small><input name="orderNumber" /></label><label>Fecha de compra <small>Opcional</small><input name="purchaseDate" type="date" /></label><label>Monto pagado (S/) <small>Opcional</small><input name="amount" type="number" min="0" step="0.01" inputMode="decimal" /></label></div></fieldset><fieldset><legend>C) Tipo de solicitud</legend><div className="complaint-type-options"><label><input type="radio" name="type" value="reclamo" defaultChecked /> Reclamo</label><label><input type="radio" name="type" value="queja" /> Queja</label></div></fieldset><fieldset><legend>D) Detalle</legend><label>Descripción del reclamo o queja<textarea name="description" rows={5} maxLength={5000} required /></label><label>Solicitud del consumidor<textarea name="consumerRequest" rows={4} maxLength={3000} required /></label></fieldset>{message && <p className="complaint-message" role="alert">{message}</p>}<button className="checkout-button complaint-submit" disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar reclamación'}</button></form>}</section><footer><span>THE BLACK CAT · ROCK BAR</span><div className="footer-links"><a className="complaints-book-link" href="/libro-de-reclamaciones">Libro de Reclamaciones</a><a href="/terminos-y-condiciones">Términos y Condiciones</a><a href="/politica-de-privacidad">Política de Privacidad</a><a href="/politica-cambios-devoluciones">Cambios y Devoluciones</a></div><span>Delivery &amp; recojo</span></footer></main>
}

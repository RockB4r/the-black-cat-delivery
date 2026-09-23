import { useRef, useState, type FormEvent } from 'react'
import './GiftCardsPublic.css'

type Receipt = { code: string; token: string; payment_code: string; amount: number; activated_at: string; expires_at: string; purchaser_name: string; recipient_name: string | null; payment_method: string }
type Prepared = { accessToken: string; culqiOrderId?: string; amountInCents: number; status: string; cardOnly?: boolean; pendingReconciliation?: boolean }
const info = 'El comprobante de pago se emitirá cuando esta Gift Card sea utilizada para adquirir productos o consumos en The Black Cat.'
const money = (amount: number) => `S/ ${amount.toFixed(2)}`
const sessionValue = (key: string) => { try { return window.sessionStorage.getItem(key) ?? '' } catch { return '' } }
const saveSession = (key: string, value: string) => { try { window.sessionStorage.setItem(key, value) } catch { /* Browser may block storage. */ } }

export function GiftCardPurchase() {
  const [amountChoice, setAmountChoice] = useState('50')
  const [customAmount, setCustomAmount] = useState('')
  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserEmail, setPurchaserEmail] = useState('')
  const [purchaserPhone, setPurchaserPhone] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [message, setMessage] = useState('')
  const [transferable, setTransferable] = useState(true)
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'whatsapp' | 'personal'>('personal')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const checkoutId = useRef(sessionValue('tbc-gift-checkout') || crypto.randomUUID())
  const accessToken = useRef(sessionValue('tbc-gift-access'))
  const submitted = useRef(false)

  const newPurchase = () => {
    checkoutId.current = crypto.randomUUID(); accessToken.current = ''; submitted.current = false
    saveSession('tbc-gift-checkout', checkoutId.current); saveSession('tbc-gift-access', '')
    setStatus('Puedes preparar una nueva compra.'); setReceipt(null)
  }

  const checkStatus = async () => {
    if (!accessToken.current) return
    setBusy(true)
    try {
      const response = await fetch('/.netlify/functions/gift-card-purchase-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: accessToken.current }) })
      const result = await response.json() as { status?: string; receipt?: Receipt; message?: string }
      if (response.ok && result.status === 'paid' && result.receipt) { setReceipt(result.receipt); setStatus('Pago confirmado. Tu Gift Card está activa.') }
      else setStatus(result.status === 'expired' ? 'La orden de pago venció. Inicia una nueva compra.' : result.message ?? 'Aún estamos confirmando el pago. No realices otro pago; vuelve a consultar en unos momentos.')
    } catch { setStatus('No pudimos consultar el pago. Vuelve a intentarlo sin realizar otro cargo.') }
    finally { setBusy(false) }
  }

  const startPurchase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || submitted.current) return
    saveSession('tbc-gift-checkout', checkoutId.current)
    if (amountChoice === 'custom' && !(Number(customAmount) > 100)) { setStatus('El monto libre debe ser mayor a S/ 100.'); return }
    if (!window.CulqiCheckout || !import.meta.env.VITE_CULQI_PUBLIC_KEY) { setStatus('El pago todavía no está disponible. Inténtalo más tarde.'); return }
    setBusy(true); setStatus('Preparando compra segura…')
    try {
      const response = await fetch('/.netlify/functions/gift-card-purchase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkoutId: checkoutId.current, amountChoice, customAmount, purchaserName, purchaserEmail, purchaserPhone, recipientName, recipientEmail, recipientPhone, message, transferable, deliveryMethod }) })
      const prepared = await response.json() as Partial<Prepared> & { message?: string }
      if (!response.ok || !prepared.accessToken || !prepared.amountInCents) { setStatus(prepared.message ?? 'No se pudo preparar la compra.'); return }
      accessToken.current = prepared.accessToken
      saveSession('tbc-gift-access', prepared.accessToken)
      if (prepared.status === 'paid' || prepared.pendingReconciliation) { await checkStatus(); return }
      const culqi = new window.CulqiCheckout(import.meta.env.VITE_CULQI_PUBLIC_KEY, {
        settings: { title: 'Gift Card · The Black Cat', currency: 'PEN', amount: prepared.amountInCents, ...(prepared.culqiOrderId ? { order: prepared.culqiOrderId } : {}) },
        client: { email: purchaserEmail.trim() },
        options: { lang: 'es', modal: true, paymentMethods: prepared.cardOnly ? { tarjeta: true } : { tarjeta: true, yape: true, billetera: true, bancaMovil: true, agente: true, cuotealo: true }, paymentMethodsSort: prepared.cardOnly ? ['tarjeta'] : ['tarjeta', 'yape', 'billetera', 'bancaMovil', 'agente', 'cuotealo'] },
        appearance: { theme: 'default', menuType: 'sliderTop' },
      })
      culqi.culqi = async () => {
        if (culqi.token) {
          culqi.close(); submitted.current = true; setBusy(true); setStatus('Confirmando pago…')
          try {
            const chargeResponse = await fetch('/.netlify/functions/gift-card-charge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: culqi.token.id, accessToken: accessToken.current }) })
            const charge = await chargeResponse.json() as { approved?: boolean; receipt?: Receipt; message?: string; pending?: boolean }
            if (charge.approved && charge.receipt) { setReceipt(charge.receipt); setStatus('Pago confirmado. Tu Gift Card está activa.') }
            else { setStatus(charge.message ?? 'No se pudo confirmar el pago.'); if (!charge.pending) submitted.current = false }
          } catch { setStatus('No pudimos confirmar el pago. No repitas el cargo; consulta el estado.'); }
          finally { setBusy(false) }
        } else if (culqi.order) { culqi.close(); submitted.current = true; setStatus('Pago pendiente de confirmación por Culqi. No repitas el cargo; consulta el estado.'); setBusy(false) }
        else { submitted.current = false; setStatus('No se inició el pago. Revisa los datos e inténtalo nuevamente.'); setBusy(false) }
      }
      submitted.current = true
      culqi.open()
      setStatus('Completa el pago en la ventana segura de Culqi.')
    } catch { submitted.current = false; setStatus('No se pudo conectar con el servicio de pago.') }
    finally { setBusy(false) }
  }

  const giftUrl = receipt ? `${window.location.origin}/gift/${receipt.token}` : ''
  const whatsappText = receipt ? encodeURIComponent(`Te regalaron una Gift Card de The Black Cat. ${giftUrl} ${info}`) : ''
  const emailSubject = encodeURIComponent('Tu Gift Card de The Black Cat – Rock Bar')
  const emailBody = receipt ? encodeURIComponent(`Te regalaron una Gift Card de The Black Cat por ${money(Number(receipt.amount))}.\nCódigo: ${receipt.code}\nVence: ${new Date(receipt.expires_at).toLocaleDateString('es-PE')}\n${giftUrl}\n${info}`) : ''
  return <main className="gift-public"><header><a href="/"><img src="/branding/LogoTBC.png" alt="The Black Cat" /> THE BLACK CAT · ROCK BAR</a></header><div className="gift-public-inner">
    {receipt ? <section className="gift-public-card gift-receipt"><p className="gift-eyebrow">COMPRA CONFIRMADA</p><h1>Constancia de compra de Gift Card</h1><p><strong>Código:</strong> {receipt.code}</p><p><strong>Monto:</strong> {money(Number(receipt.amount))}</p><p><strong>Fecha de compra:</strong> {new Date(receipt.activated_at).toLocaleString('es-PE')}</p><p><strong>Vencimiento:</strong> {new Date(receipt.expires_at).toLocaleDateString('es-PE')}</p><p><strong>Comprador:</strong> {receipt.purchaser_name}</p>{receipt.recipient_name && <p><strong>Beneficiario:</strong> {receipt.recipient_name}</p>}<p><strong>Medio de pago:</strong> Culqi</p><p className="gift-info">Esta constancia acredita la adquisición de una Gift Card y no constituye un comprobante de pago por productos o consumos. {info}</p><a className="gift-primary" href={giftUrl}>Ver Gift Card digital</a><a className="gift-secondary" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Compartir por WhatsApp</a><a className="gift-secondary" href={`mailto:${encodeURIComponent(recipientEmail)}?subject=${emailSubject}&body=${emailBody}`}>Compartir por email</a></section> : <section className="gift-public-card"><p className="gift-eyebrow">UN REGALO CON ACTITUD</p><h1>GIFT CARDS</h1><p>Regala la experiencia The Black Cat. Válida por 45 días desde la confirmación de compra.</p><form onSubmit={(event) => { void startPurchase(event) }}>
      <fieldset><legend>1 · Elige un monto</legend><div className="gift-choices">{['50','75','100','200','custom'].map((value) => <label key={value}><input type="radio" name="amount" checked={amountChoice === value} onChange={() => setAmountChoice(value)} />{value === 'custom' ? 'Otro monto' : `S/ ${value}`}</label>)}</div>{amountChoice === 'custom' && <label>Monto libre mayor a S/ 100<input type="number" min="100.01" step="0.01" required value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} /></label>}</fieldset>
      <fieldset><legend>2 · Comprador</legend><label>Nombre completo<input required maxLength={160} value={purchaserName} onChange={(event) => setPurchaserName(event.target.value)} /></label><label>Correo electrónico<input required type="email" maxLength={254} value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.target.value)} /></label><label>Teléfono (opcional)<input type="tel" maxLength={40} value={purchaserPhone} onChange={(event) => setPurchaserPhone(event.target.value)} /></label></fieldset>
      <fieldset><legend>3 · Beneficiario</legend><label>Nombre {!transferable && '(obligatorio)'}<input required={!transferable} maxLength={160} value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label><label>Correo electrónico (opcional)<input type="email" required={deliveryMethod === 'email'} maxLength={254} value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} /></label><label>Teléfono / WhatsApp (opcional)<input type="tel" required={deliveryMethod === 'whatsapp'} maxLength={40} value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} /></label><label>Mensaje personal (opcional)<textarea maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} /></label><label className="gift-inline"><input type="checkbox" checked={transferable} onChange={(event) => setTransferable(event.target.checked)} /> Puede transferirse a otra persona</label></fieldset>
      <fieldset><legend>4 · Entrega</legend><div className="gift-choices">{([['email','Email'],['whatsapp','WhatsApp'],['personal','La entregaré personalmente']] as const).map(([value,label]) => <label key={value}><input type="radio" name="delivery" checked={deliveryMethod === value} onChange={() => setDeliveryMethod(value)} />{label}</label>)}</div><small>El envío automático aún no está disponible. Al confirmar la compra podrás compartir el enlace digital personalmente.</small></fieldset>
      <p className="gift-info">{info}</p><button className="gift-primary" type="submit" disabled={busy || submitted.current}>{busy ? 'Procesando…' : 'Comprar con Culqi'}</button>
    </form>{status && <p role="status" className="gift-status">{status}</p>}{accessToken.current && <button className="gift-secondary" disabled={busy} onClick={() => { void checkStatus() }}>Consultar estado del pago</button>}{status.startsWith('La orden de pago venció') && <button className="gift-secondary" disabled={busy} onClick={newPurchase}>Iniciar otra compra</button>}</section>}
  </div></main>
}

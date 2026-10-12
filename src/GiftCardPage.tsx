import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import './GiftCardsPublic.css'
import './GiftCardPage.css'

type PublicCard = { code: string; paymentCode: string; purchaserName: string; recipientName: string | null; message: string | null; originalAmount: number; balance: number; activatedAt: string; expiresAt: string; status: string }
const statusText: Record<string, string> = { active: 'Activa', blocked: 'Gift Card temporalmente bloqueada', expired: 'Gift Card vencida', exhausted: 'Gift Card utilizada', pending: 'Pendiente' }
const info = 'El comprobante de pago se emitirá cuando esta Gift Card sea utilizada para adquirir productos o consumos en The Black Cat.'

export function GiftCardPage() {
  const token = window.location.pathname.split('/')[2] ?? ''
  const [card, setCard] = useState<PublicCard | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  useEffect(() => {
    let active = true
    if (!/^[a-f0-9]{64}$/.test(token)) { setError('Gift Card no encontrada.'); return }
    void fetch(`/.netlify/functions/gift-card-public?token=${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async (response) => {
      const data = await response.json() as PublicCard & { message?: string }
      if (!active) return
      if (!response.ok) { setError(data.message ?? 'No se pudo consultar la Gift Card.'); return }
      setCard(data)
    }).catch(() => { if (active) setError('No se pudo consultar la Gift Card.') })
    void QRCode.toDataURL(`${window.location.origin}/gift/${token}`, { width: 280, margin: 2 }).then((url) => { if (active) setQr(url) })
    return () => { active = false }
  }, [token])
  const copyPaymentCode = async () => {
    if (!card) return
    try {
      await navigator.clipboard.writeText(card.paymentCode)
      setCopyMessage('Código de pago copiado.')
    } catch {
      setCopyMessage('No se pudo copiar. Selecciona el código manualmente.')
    }
  }

  return <main className="gift-public">
    <header><a href="/"><img src="/branding/LogoTBC.png" alt="The Black Cat" /> THE BLACK CAT · ROCK BAR</a></header>
    <div className="gift-public-inner"><section className="gift-public-card gift-digital">
      <p className="gift-eyebrow">HERITAGE GROUP S.A.C. · THE BLACK CAT</p><h1>GIFT CARD</h1>
      {error ? <p role="alert">{error}</p> : !card ? <p>Consultando Gift Card…</p> : <>
        <span className={`gift-state gift-state-${card.status}`}>{statusText[card.status] ?? card.status}</span>
        {card.recipientName && <h2>Para {card.recipientName}</h2>}
        <p>De {card.purchaserName}</p>
        {card.message && <blockquote>{card.message}</blockquote>}
        <div className="gift-balance"><span>Valor original: S/ {Number(card.originalAmount).toFixed(2)}</span><strong>Saldo actual: S/ {Number(card.balance).toFixed(2)}</strong></div>
        <p>Válida hasta {new Date(card.expiresAt).toLocaleDateString('es-PE')}</p>
        <div className="gift-identifier"><h3>Código de Gift Card</h3><strong>{card.code}</strong></div>
        <div className="gift-identifier"><h3>QR / enlace digital</h3>{qr && <img className="gift-qr" src={qr} alt={`QR para abrir la Gift Card ${card.code}`} />}<p>El QR sirve para abrir y ver esta Gift Card. No es el código para pagar online.</p></div>
        <div className="gift-identifier"><h3>Código secreto para pagar online</h3><strong className="gift-payment-code">{card.paymentCode}</strong><button className="gift-secondary" type="button" onClick={() => { void copyPaymentCode() }}>Copiar código de pago</button><p>Usa este código en el checkout cuando selecciones Pagar con Gift Card.</p>{copyMessage && <p role="status">{copyMessage}</p>}</div>
        <p className="gift-info">{info}</p><a className="gift-primary" href="/">Ir a la WebApp</a>
      </>}
    </section></div>
  </main>
}

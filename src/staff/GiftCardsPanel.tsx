import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import type { StaffProfile } from './types'
import { canManageGiftCards } from './giftCardPermissions'
import './GiftCardsPanel.css'

type GiftCard = {
  id: string
  code: string
  qr_token: string
  initial_balance: number
  current_balance: number
  status: 'pending' | 'active' | 'exhausted' | 'expired' | 'blocked'
  purchaser_name: string
  recipient_name: string | null
  recipient_email: string | null
  recipient_phone: string | null
  gift_message: string | null
  transferable: boolean
  created_at: string
  activated_at: string | null
  expires_at: string | null
}

type GiftTransaction = {
  id: string
  movement_type: 'creation' | 'redemption' | 'block'
  amount: number
  balance_before: number
  balance_after: number
  reference: string | null
  created_at: string
}

type RedemptionResult = { debited: number; remaining_to_pay: number; balance: number; idempotent: boolean }

const cardFields = 'id, code, qr_token, initial_balance, current_balance, status, purchaser_name, recipient_name, recipient_email, recipient_phone, gift_message, transferable, created_at, activated_at, expires_at'
const money = (amount: number) => `S/ ${Number(amount).toFixed(2)}`
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
const statusOf = (card: GiftCard) => card.status === 'active' && card.expires_at && new Date(card.expires_at).getTime() <= Date.now() ? 'expired' : card.status
const statusLabel: Record<GiftCard['status'], string> = { pending: 'Pendiente', active: 'Activa', exhausted: 'Agotada', expired: 'Vencida', blocked: 'Bloqueada' }

export function GiftCardsPanel({ profile }: { profile: StaffProfile }) {
  const canManage = canManageGiftCards(profile.role)
  const [showCreate, setShowCreate] = useState(false)
  const [cards, setCards] = useState<GiftCard[]>([])
  const [searchResults, setSearchResults] = useState<GiftCard[] | null>(null)
  const [selected, setSelected] = useState<GiftCard | null>(null)
  const [transactions, setTransactions] = useState<GiftTransaction[]>([])
  const [search, setSearch] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [fixedAmount, setFixedAmount] = useState('50')
  const [customAmount, setCustomAmount] = useState('')
  const [purchaser, setPurchaser] = useState('')
  const [recipient, setRecipient] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [giftMessage, setGiftMessage] = useState('')
  const [transferable, setTransferable] = useState(true)
  const [consumptionAmount, setConsumptionAmount] = useState('')
  const [verifiedRecipient, setVerifiedRecipient] = useState('')
  const [redemption, setRedemption] = useState<RedemptionResult | null>(null)
  // Keep the same reference if a network error makes the result uncertain.
  const redemptionReference = useRef(crypto.randomUUID())

  const loadCards = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('gift_cards').select(cardFields).order('created_at', { ascending: false }).limit(100)
    if (error) setMessage('No se pudo cargar Gift Cards. Verifica que la migración esté aplicada.')
    else setCards((data ?? []) as GiftCard[])
    setLoading(false)
  }

  useEffect(() => { void loadCards() }, [])

  useEffect(() => {
    if (!selected) { setQrUrl(''); setTransactions([]); return }
    let current = true
    const target = `${window.location.origin}/staff#gift-card=${selected.qr_token}`
    void QRCode.toDataURL(target, { width: 232, margin: 2, errorCorrectionLevel: 'M' }).then((url) => { if (current) setQrUrl(url) }).catch(() => { if (current) setQrUrl('') })
    void supabase.from('gift_card_transactions').select('id, movement_type, amount, balance_before, balance_after, reference, created_at').eq('gift_card_id', selected.id).order('created_at', { ascending: false }).then(({ data }) => { if (current) setTransactions((data ?? []) as GiftTransaction[]) })
    return () => { current = false }
  }, [selected])

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('gift-card')
    if (!token) return
    window.history.replaceState(null, '', '/staff')
    void supabase.from('gift_cards').select(cardFields).eq('qr_token', token).maybeSingle().then(({ data, error }) => {
      if (error || !data) setMessage('No se encontró la Gift Card del QR.')
      else { setSelected(data as GiftCard); setMessage('Gift Card encontrada por QR.') }
    })
  }, [])

  const refreshSelected = async (id: string) => {
    const { data } = await supabase.from('gift_cards').select(cardFields).eq('id', id).maybeSingle()
    if (data) setSelected(data as GiftCard)
    await loadCards()
  }

  const findCard = async (event: FormEvent) => {
    event.preventDefault()
    const query = search.trim()
    if (!query) return
    setMessage('')
    setRedemption(null)
    const token = query.includes('#gift-card=') ? query.split('#gift-card=')[1] : null
    if (token || /^BC-GC-/i.test(query)) {
      const result = await supabase.from('gift_cards').select(cardFields).eq(token ? 'qr_token' : 'code', token ?? query.toUpperCase()).maybeSingle()
      if (result.error || !result.data) { setSearchResults([]); setMessage('No se encontró una Gift Card con ese código o QR.') }
      else { setSelected(result.data as GiftCard); setSearchResults([result.data as GiftCard]) }
      return
    }
    const name = `%${query.replace(/[\\%_]/g, '\\$&')}%`
    const [byPurchaser, byRecipient] = await Promise.all([
      supabase.from('gift_cards').select(cardFields).ilike('purchaser_name', name).order('created_at', { ascending: false }).limit(100),
      supabase.from('gift_cards').select(cardFields).ilike('recipient_name', name).order('created_at', { ascending: false }).limit(100),
    ])
    if (byPurchaser.error || byRecipient.error) { setMessage('No se pudo buscar por nombre.'); return }
    const found = Array.from(new Map([...(byPurchaser.data ?? []), ...(byRecipient.data ?? [])].map((card) => [card.id, card as GiftCard])).values())
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    setSearchResults(found)
    if (found.length === 0) setMessage('No se encontraron Gift Cards con ese nombre.')
    else if (found.length === 1) setSelected(found[0])
  }

  const createCard = async (event: FormEvent) => {
    event.preventDefault()
    if (!canManage || busy) return
    const amount = Number(fixedAmount === 'custom' ? customAmount : fixedAmount)
    if (!Number.isFinite(amount) || (fixedAmount === 'custom' && amount <= 100) || !purchaser.trim() || (!transferable && !recipient.trim())) { setMessage('Verifica monto, comprador y beneficiario.'); return }
    if (!window.confirm(`¿Crear y activar una Gift Card por ${money(amount)}? Vencerá en 45 días.`)) return
    setBusy(true); setMessage('')
    const { data, error } = await supabase.rpc('create_gift_card', {
      p_amount: amount, p_purchaser_name: purchaser.trim(), p_recipient_name: recipient.trim() || null,
      p_recipient_email: email.trim() || null, p_recipient_phone: phone.trim() || null,
      p_message: giftMessage.trim() || null, p_transferable: transferable,
    })
    if (error || !data) setMessage(`No se pudo crear la Gift Card: ${error?.message ?? 'Error desconocido'}`)
    else { setSelected(data as GiftCard); setMessage('Gift Card creada y activada. Entrega el QR o código al comprador.'); setPurchaser(''); setRecipient(''); setEmail(''); setPhone(''); setGiftMessage(''); await loadCards() }
    setBusy(false)
  }

  const redeemCard = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected || busy || statusOf(selected) !== 'active') return
    const amount = Number(consumptionAmount)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount * 100)) { setMessage('Ingresa un monto válido en soles con hasta dos decimales.'); return }
    if (!selected.transferable && verifiedRecipient.trim().toLocaleLowerCase('es-PE') !== selected.recipient_name?.trim().toLocaleLowerCase('es-PE')) { setMessage('Confirma el nombre del beneficiario antes de canjear.'); return }
    const debit = Math.min(amount, Number(selected.current_balance))
    const rest = amount - debit
    if (!window.confirm(`¿Canjear ${money(debit)} de ${selected.code}? ${rest > 0 ? `El cliente debe pagar ${money(rest)} por otro medio.` : ''}`)) return
    setBusy(true); setMessage(''); setRedemption(null)
    const { data, error } = await supabase.rpc('redeem_gift_card', {
      p_card_id: selected.id, p_consumption_amount: amount, p_reference: redemptionReference.current,
      p_recipient_name: selected.transferable ? null : verifiedRecipient.trim(),
    })
    if (error || !data) setMessage(`No se pudo canjear: ${error?.message ?? 'Error desconocido'}`)
    else { const result = data as RedemptionResult; redemptionReference.current = crypto.randomUUID(); setRedemption(result); setMessage(result.idempotent ? 'Canje ya registrado; no se descontó nuevamente.' : 'Canje registrado.'); setConsumptionAmount(''); await refreshSelected(selected.id) }
    setBusy(false)
  }

  const blockCard = async () => {
    if (!canManage || !selected || busy || statusOf(selected) !== 'active') return
    if (!window.confirm(`¿Bloquear ${selected.code}? Quedará inutilizable y la acción se registrará en el historial.`)) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('block_gift_card', { p_card_id: selected.id })
    if (error) setMessage(`No se pudo bloquear: ${error.message}`)
    else { setMessage('Gift Card bloqueada.'); await refreshSelected(selected.id) }
    setBusy(false)
  }

  const visibleCards = searchResults ?? cards

  return <section className="staff-section gift-cards-panel">
    <div className="staff-section-title"><div><h2>Gift Cards</h2><p>Emisión y canje interno en The Black Cat. La creación activa la tarjeta por 45 días.</p></div><div className="gift-card-actions">{canManage && <button type="button" className="staff-primary" aria-expanded={showCreate} onClick={() => setShowCreate((current) => !current)}>{showCreate ? 'Ocultar formulario' : 'Crear Gift Card'}</button>}<button type="button" className="staff-secondary" onClick={() => void loadCards()} disabled={loading}>Actualizar</button></div></div>
    {message && <p className="staff-message" role="status">{message}</p>}
    {canManage && showCreate && <div className="gift-card-create"><form className="staff-form gift-card-form" onSubmit={createCard}>
      <label>Monto<select value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)}><option value="50">S/ 50</option><option value="75">S/ 75</option><option value="100">S/ 100</option><option value="200">S/ 200</option><option value="custom">Monto libre (más de S/ 100)</option></select></label>
      {fixedAmount === 'custom' && <label>Monto libre (S/)<input type="number" min="100.01" step="0.01" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} required /></label>}
      <label>Nombre del comprador<input value={purchaser} onChange={(event) => setPurchaser(event.target.value)} maxLength={160} required /></label>
      <label>Nombre del beneficiario {!transferable && '(obligatorio)'}<input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={160} required={!transferable} /></label>
      <label>Email del beneficiario (opcional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} /></label>
      <label>Teléfono / WhatsApp (opcional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} /></label>
      <label>Mensaje de regalo (opcional)<textarea value={giftMessage} onChange={(event) => setGiftMessage(event.target.value)} maxLength={1000} /></label>
      <label className="staff-checkbox"><input type="checkbox" checked={transferable} onChange={(event) => setTransferable(event.target.checked)} /> Transferible: puede usarla quien presente el código o QR</label>
      <button className="staff-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear y activar Gift Card'}</button>
    </form></div>}
    <form className="staff-form gift-card-search" onSubmit={findCard}><label>Buscar por código, nombre o pegar enlace QR<input value={search} onChange={(event) => { setSearch(event.target.value); setSearchResults(null) }} placeholder="BC-GC-000143 o nombre" /></label><button className="staff-primary">Consultar</button></form>
    <div className="gift-card-list" aria-label="Gift Cards recientes">{loading ? <p>Cargando…</p> : visibleCards.length === 0 ? <p>No hay Gift Cards recientes para mostrar.</p> : visibleCards.map((card) => <button key={card.id} type="button" onClick={() => { setSelected(card); setRedemption(null) }} className={selected?.id === card.id ? 'selected' : ''}><strong>{card.code}</strong><span>{card.recipient_name || card.purchaser_name}</span><span>{statusLabel[statusOf(card)]} · {money(card.current_balance)} / {money(card.initial_balance)}</span><small>Vence: {date(card.expires_at)}</small></button>)}</div>
    {selected && <div className="gift-card-detail"><div className="staff-section-title"><div><h3>{selected.code}</h3><p>{statusLabel[statusOf(selected)]} · Saldo {money(selected.current_balance)} de {money(selected.initial_balance)}</p></div>{canManage && statusOf(selected) === 'active' && <button type="button" className="staff-danger" disabled={busy} onClick={() => void blockCard()}>Bloquear</button>}</div>
      <div className="gift-card-detail-grid"><div><p>Comprador: <strong>{selected.purchaser_name}</strong></p><p>Beneficiario: <strong>{selected.recipient_name || 'No indicado'}</strong></p><p>{selected.transferable ? 'Transferible' : 'No transferible: verificar beneficiario al canjear'}</p><p>Activación: {date(selected.activated_at)}<br />Vencimiento: {date(selected.expires_at)}</p>{selected.gift_message && <p>Mensaje: {selected.gift_message}</p>}{selected.recipient_email && <p>Email: {selected.recipient_email}</p>}{selected.recipient_phone && <p>Teléfono: {selected.recipient_phone}</p>}</div><div className="gift-card-qr">{qrUrl ? <img src={qrUrl} alt={`QR de Gift Card ${selected.code}`} /> : <p>No se pudo generar el QR.</p>}<small>El QR no contiene el saldo. Solo el staff autenticado puede consultarlo.</small><button type="button" className="staff-secondary" disabled title="El reenvío por email y WhatsApp estará disponible en una fase posterior">Reenviar próximamente</button></div></div>
      {statusOf(selected) === 'active' && <form className="staff-form gift-card-redeem" onSubmit={redeemCard}><h3>Canjear</h3><label>Monto total del consumo (S/)<input type="number" min="0.01" step="0.01" value={consumptionAmount} onChange={(event) => setConsumptionAmount(event.target.value)} required /></label>{!selected.transferable && <label>Nombre del beneficiario verificado<input value={verifiedRecipient} onChange={(event) => setVerifiedRecipient(event.target.value)} required /></label>}<p>Se usará hasta {money(Math.min(Number(consumptionAmount) || 0, Number(selected.current_balance)))} de la Gift Card. Excedente a pagar por otro medio: {money(Math.max((Number(consumptionAmount) || 0) - Number(selected.current_balance), 0))}.</p><button className="staff-primary" disabled={busy}>{busy ? 'Registrando…' : 'Confirmar canje'}</button></form>}
      {redemption && <p className="gift-card-result" role="status">Aplicado: {money(redemption.debited)} · Nuevo saldo: {money(redemption.balance)} · A cobrar por otro medio: {money(redemption.remaining_to_pay)}</p>}
      <h3>Historial</h3><ul className="gift-card-history">{transactions.map((item) => <li key={item.id}><strong>{item.movement_type === 'creation' ? 'Creación' : item.movement_type === 'redemption' ? 'Canje' : 'Bloqueo'}</strong><span>{date(item.created_at)}</span><span>{money(item.balance_before)} → {money(item.balance_after)}</span>{item.reference && <small>Referencia: {item.reference}</small>}</li>)}</ul>
    </div>}
  </section>
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Promotion = { id: string; code: string; discount_percent: number; minimum_subtotal: number; starts_at: string; expires_at: string; max_uses_per_customer: number; max_uses_total: number | null; status: 'draft' | 'active' | 'paused' | 'expired' }

const datetimeInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const formatDate = (value: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function PromotionManagement() {
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [code, setCode] = useState('')
  const [discountPercent, setDiscountPercent] = useState('10')
  const [minimumSubtotal, setMinimumSubtotal] = useState('30')
  const [startsAt, setStartsAt] = useState(() => datetimeInput(new Date()))
  const [expiresAt, setExpiresAt] = useState(() => datetimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)))
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState('2')
  const [activateNow, setActivateNow] = useState(false)

  const request = useCallback(async (path = '', init?: RequestInit) => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.')
    const response = await fetch(`/.netlify/functions/admin-promotions${path}`, { ...init, headers: { Authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } })
    const result = await response.json().catch(() => null) as Promotion[] | { message?: string }
    if (!response.ok) throw new Error(!Array.isArray(result) && result?.message ? result.message : 'No fue posible completar la operación.')
    return result
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try { const result = await request(); setPromotions(Array.isArray(result) ? result : []) } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar las promociones.') } finally { setLoading(false) }
  }, [request])
  useEffect(() => { void load() }, [load])

  const createPromotion = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      await request('', { method: 'POST', body: JSON.stringify({ code, discountPercent: Number(discountPercent), minimumSubtotal: Number(minimumSubtotal), startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), maxUsesPerCustomer: Number(maxUsesPerCustomer), status: activateNow ? 'active' : 'draft' }) })
      setMessage(activateNow ? 'Código creado y activado.' : 'Código creado como borrador. Actívalo cuando vayas a comunicarlo.')
      setCode(''); setActivateNow(false); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible crear el código.') } finally { setSaving(false) }
  }
  const changeStatus = async (promotion: Promotion) => {
    const status = promotion.status === 'active' ? 'paused' : 'active'
    try { await request('', { method: 'PATCH', body: JSON.stringify({ id: promotion.id, status }) }); await load() } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible actualizar el código.') }
  }

  return <section className="staff-section promotion-management"><div className="staff-section-title"><div><h2>Códigos de descuento</h2><p>Crea campañas por porcentaje, con mínimo de compra, vigencia y límite de usos por cliente.</p></div></div>
    <form className="staff-form promotion-admin-form" onSubmit={(event) => void createPromotion(event)}><label>Código<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="ROCK10" maxLength={32} pattern="[A-Za-z0-9_-]{3,32}" required /></label><label>Descuento (%)<input type="number" min="1" max="100" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} required /></label><label>Compra mínima (S/)<input type="number" min="0" step="0.01" value={minimumSubtotal} onChange={(event) => setMinimumSubtotal(event.target.value)} required /></label><label>Inicio<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label><label>Vencimiento<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></label><label>Usos máximos por cliente<input type="number" min="1" value={maxUsesPerCustomer} onChange={(event) => setMaxUsesPerCustomer(event.target.value)} required /></label><label className="staff-checkbox"><input type="checkbox" checked={activateNow} onChange={(event) => setActivateNow(event.target.checked)} /> Activar ahora</label><button className="staff-primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear código'}</button></form>
    {message && <p className="staff-message" role="status">{message}</p>}
    {loading ? <p>Cargando códigos…</p> : promotions.length === 0 ? <p>Aún no hay códigos creados.</p> : <ul className="promotion-list">{promotions.map((promotion) => <li key={promotion.id}><div><strong>{promotion.code}</strong><span>{promotion.discount_percent}% · mínimo S/ {Number(promotion.minimum_subtotal).toFixed(2)} · {promotion.max_uses_per_customer} usos por cliente</span><small>{formatDate(promotion.starts_at)} — {formatDate(promotion.expires_at)}</small></div><button type="button" className={promotion.status === 'active' ? 'staff-danger' : 'staff-primary'} onClick={() => void changeStatus(promotion)}>{promotion.status === 'active' ? 'Pausar' : 'Activar'}</button></li>)}</ul>}
  </section>
}

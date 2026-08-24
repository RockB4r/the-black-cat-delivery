import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Member, PointMovement, RewardCategory, StaffProfile } from './types'

const rewards: { value: RewardCategory; label: string }[] = [
  { value: 'craft_beer', label: 'Cerveza artesanal' }, { value: 'cocktail', label: 'Cóctel' },
  { value: 'burger', label: 'Burger' }, { value: 'sandwich', label: 'Sandwich' },
  { value: 'wings', label: 'Wings' }, { value: 'wrap', label: 'Wrap' },
]

const hideDni = (dni: string) => `${'*'.repeat(Math.max(0, dni.length - 2))}${dni.slice(-2)}`
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
const pointsFromMovement = (movement: PointMovement) => Number(movement.points)

export function StaffDashboard({ profile, userId, onSignOut }: { profile: StaffProfile; userId: string; onSignOut: () => Promise<void> }) {
  const [dni, setDni] = useState('')
  const [phone, setPhone] = useState('')
  const [member, setMember] = useState<Member | null>(null)
  const [movements, setMovements] = useState<PointMovement[]>([])
  const [searching, setSearching] = useState(false)
  const [savingConsumption, setSavingConsumption] = useState(false)
  const [savingRedemption, setSavingRedemption] = useState(false)
  const [message, setMessage] = useState('')
  const [amount, setAmount] = useState('')
  const [consumptionNotes, setConsumptionNotes] = useState('')
  const [rewardCategory, setRewardCategory] = useState<RewardCategory>('craft_beer')
  const [rewardProductName, setRewardProductName] = useState('')

  const loadMemberDetails = async (memberId: string) => {
    const [{ data: currentMember, error: memberError }, { data: history, error: historyError }] = await Promise.all([
      supabase.from('members').select('id, dni, full_name, phone, email, birth_date, joined_at, points_balance, status, marketing_consent').eq('id', memberId).maybeSingle<Member>(),
      supabase.from('point_movements').select('id, member_id, points, movement_type, source_type, source_id, description, registered_by, created_at').eq('member_id', memberId).order('created_at', { ascending: false }).limit(10),
    ])
    if (memberError || !currentMember) throw new Error('No se pudo actualizar el socio.')
    setMember(currentMember)
    setMovements(historyError ? [] : (history as PointMovement[] ?? []))
  }

  const searchMember = async (event: FormEvent) => {
    event.preventDefault()
    const safeDni = dni.replace(/\D/g, '')
    const safePhone = phone.trim()
    if (!safeDni && !safePhone) { setMessage('Ingresa el DNI o teléfono del socio.'); return }
    if (safeDni && safeDni.length !== 8) { setMessage('El DNI debe tener 8 dígitos.'); return }
    setSearching(true); setMessage(''); setMember(null); setMovements([])
    try {
      const query = supabase.from('members').select('id, dni, full_name, phone, email, birth_date, joined_at, points_balance, status, marketing_consent').limit(1)
      const { data, error } = safeDni ? await query.eq('dni', safeDni).maybeSingle<Member>() : await query.eq('phone', safePhone).maybeSingle<Member>()
      if (error) setMessage('No se pudo buscar al socio. Intenta nuevamente.')
      else if (!data) setMessage('No encontramos un socio con esos datos.')
      else { await loadMemberDetails(data.id); setMessage('') }
    } catch {
      setMessage('No se pudo cargar la información del socio. Verifica tus permisos.')
    } finally {
      setSearching(false)
    }
  }

  const registerConsumption = async (event: FormEvent) => {
    event.preventDefault()
    if (!member || member.status !== 'active') return
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setMessage('Ingresa un monto válido mayor a S/ 0.'); return }
    setSavingConsumption(true); setMessage('')
    try {
      const { error } = await supabase.from('consumptions').insert({ member_id: member.id, amount: numericAmount, source: 'bar', registered_by: userId, notes: consumptionNotes.trim() || null })
      if (error) setMessage('No se pudo registrar el consumo. Verifica tus permisos e intenta nuevamente.')
      else { await loadMemberDetails(member.id); setAmount(''); setConsumptionNotes(''); setMessage('Consumo registrado correctamente.') }
    } catch {
      setMessage('El consumo se registró, pero no se pudo refrescar el saldo. Vuelve a buscar al socio.')
    } finally {
      setSavingConsumption(false)
    }
  }

  const redeemReward = async (event: FormEvent) => {
    event.preventDefault()
    if (!member || member.status !== 'active' || Number(member.points_balance) < 20) return
    if (!window.confirm(`Se descontarán 20 puntos de ${member.full_name}. ¿Confirmar canje?`)) return
    setSavingRedemption(true); setMessage('')
    try {
      const { error } = await supabase.from('redemptions').insert({ member_id: member.id, points_spent: 20, reward_category: rewardCategory, reward_product_name: rewardProductName.trim() || null, registered_by: userId, notes: null })
      if (error) setMessage('No se pudo registrar el canje. El saldo pudo haber cambiado; actualiza e intenta nuevamente.')
      else { await loadMemberDetails(member.id); setRewardProductName(''); setMessage('Canje registrado correctamente.') }
    } catch {
      setMessage('El canje se registró, pero no se pudo refrescar el saldo. Vuelve a buscar al socio.')
    } finally {
      setSavingRedemption(false)
    }
  }

  const estimatedPoints = Math.floor(Math.max(0, Number(amount) || 0) / 30) * 2
  const remainingPoints = member ? Math.max(0, 20 - Number(member.points_balance)) : 20
  const canOperate = member?.status === 'active'

  return <main className="staff-page"><section className="staff-card staff-dashboard">
    <header className="staff-header"><div><p className="eyebrow">THE BLACK CAT · STAFF</p><h1>Hola, {profile.display_name}</h1><p className="staff-role">Rol: {profile.role}</p></div><button className="back-button staff-signout" type="button" onClick={() => void onSignOut()}>Cerrar sesión</button></header>
    <section className="staff-section"><h2>Buscar socio</h2><p>Busca por DNI exacto o teléfono. No se cargan socios automáticamente.</p>
      <form className="staff-form staff-search-form" onSubmit={searchMember}><label>DNI<input inputMode="numeric" maxLength={8} value={dni} onChange={(event) => { setDni(event.target.value.replace(/\D/g, '')); setPhone('') }} placeholder="8 dígitos" /></label><span className="staff-or">o</span><label>Teléfono<input inputMode="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setDni('') }} placeholder="Teléfono registrado" /></label><button className="staff-primary" disabled={searching}>{searching ? 'Buscando…' : 'Buscar socio'}</button></form>
    </section>
    {message && <p className="staff-message" role="status">{message}</p>}
    {member && <div className="member-workspace">
      <section className="staff-section member-summary"><div><p className="eyebrow">SOCIO ENCONTRADO</p><h2>{member.full_name}</h2><p>DNI: {hideDni(member.dni)} · {member.phone || 'Sin teléfono'}</p><p>Ingreso: {formatDate(member.joined_at)}</p></div><div className="points-panel"><strong>{member.points_balance} / 20</strong><span>puntos</span>{Number(member.points_balance) >= 20 ? <b>¡Beneficio disponible!</b> : <small>Te faltan {remainingPoints} puntos para tu beneficio</small>}</div></section>
      {!canOperate && <p className="staff-warning">Este socio está {member.status}. No se pueden registrar consumos ni canjes.</p>}
      <div className="staff-operation-grid">
        <form className="staff-section staff-form" onSubmit={registerConsumption}><h2>Registrar consumo</h2><label>Monto consumido (S/)<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!canOperate || savingConsumption} placeholder="0.00" required /></label><p className="staff-preview">Este consumo generará <strong>{estimatedPoints} puntos</strong>.</p><label>Observación <textarea value={consumptionNotes} onChange={(event) => setConsumptionNotes(event.target.value)} disabled={!canOperate || savingConsumption} placeholder="Opcional" /></label><button className="staff-primary" disabled={!canOperate || savingConsumption}>{savingConsumption ? 'Registrando…' : 'Registrar consumo'}</button></form>
        <form className="staff-section staff-form" onSubmit={redeemReward}><h2>Canjear beneficio</h2><label>Beneficio<select value={rewardCategory} onChange={(event) => setRewardCategory(event.target.value as RewardCategory)} disabled={!canOperate || Number(member.points_balance) < 20 || savingRedemption}>{rewards.map((reward) => <option key={reward.value} value={reward.value}>{reward.label}</option>)}</select></label><label>Producto entregado<input value={rewardProductName} onChange={(event) => setRewardProductName(event.target.value)} disabled={!canOperate || Number(member.points_balance) < 20 || savingRedemption} placeholder="Opcional" /></label><p className="staff-preview">Se descontarán <strong>20 puntos</strong> de {member.full_name}.</p><button className="staff-primary" disabled={!canOperate || Number(member.points_balance) < 20 || savingRedemption}>{savingRedemption ? 'Registrando…' : 'Canjear beneficio'}</button></form>
      </div>
      <section className="staff-section staff-history"><h2>Historial reciente</h2>{movements.length === 0 ? <p>Aún no hay movimientos para mostrar.</p> : <ul>{movements.map((movement) => { const points = pointsFromMovement(movement); return <li key={movement.id}><time>{formatDate(movement.created_at)}</time><div><strong>{movement.movement_type}</strong><span>{movement.description}</span></div><b className={points > 0 ? 'points-positive' : 'points-negative'}>{points > 0 ? '+' : ''}{points} pts</b></li> })}</ul>}</section>
    </div>}
  </section></main>
}

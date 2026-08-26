import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { isOnlineOrderingOpen } from './lib/onlineOrdering'
import type { StaffRole } from './staff/types'

const KITCHEN_EMAIL = 'kitchen@theblackcatrockbar.com'
const rejectionReasons = ['Stock agotado', 'Producto no disponible', 'Cocina cerrada por horario', 'Problema técnico', 'Otro'] as const
type RejectionReason = typeof rejectionReasons[number]
type KitchenStatus = 'nuevo' | 'preparando' | 'listo' | 'en_camino' | 'entregado' | 'cancelado' | 'rechazado'
type KitchenItem = { id: string; product_name: string; category: string; quantity: number; unit_price: number; notes: string | null }
type KitchenOrder = { id: string; order_number: string; customer_name: string; customer_phone: string; order_type: 'delivery' | 'pick_up'; delivery_address: string | null; delivery_reference: string | null; payment_status: string; status: KitchenStatus; total: number; notes: string | null; created_at: string; order_items: KitchenItem[] }
type KitchenAvailability = { manual_closed: boolean; force_open: boolean }

const columns: Array<{ title: string; status: KitchenStatus }> = [{ title: 'Nuevos pedidos', status: 'nuevo' }, { title: 'Preparando', status: 'preparando' }, { title: 'Listos', status: 'listo' }]
const formatTime = (date: string) => new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(date))

const playAlert = () => {
  try {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    ;[0, 0.24].forEach((startAt) => {
      const oscillator = context.createOscillator(); const gain = context.createGain()
      oscillator.type = 'square'; oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, context.currentTime + startAt); gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + startAt + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startAt + 0.17)
      oscillator.connect(gain).connect(context.destination); oscillator.start(context.currentTime + startAt); oscillator.stop(context.currentTime + startAt + 0.18)
    })
    window.setTimeout(() => void context.close(), 700)
  } catch { /* The display continues when a browser blocks audio. */ }

  window.setTimeout(() => {
    if (!('speechSynthesis' in window)) return
    const announcement = new SpeechSynthesisUtterance('Tienes un nuevo pedido de Web')
    announcement.lang = 'es-PE'
    announcement.rate = 1
    announcement.pitch = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(announcement)
  }, 480)
}

export function KitchenDisplay() {
  const [user, setUser] = useState<User | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [password, setPassword] = useState('')
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loginMessage, setLoginMessage] = useState('')
  const [message, setMessage] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [rejectingOrder, setRejectingOrder] = useState<KitchenOrder | null>(null)
  const [rejectionReason, setRejectionReason] = useState<RejectionReason>('Stock agotado')
  const [rejectionComment, setRejectionComment] = useState('')
  const [kitchenAvailability, setKitchenAvailability] = useState<KitchenAvailability>({ manual_closed: false, force_open: false })
  const [scheduleOpen, setScheduleOpen] = useState(() => isOnlineOrderingOpen())
  const [updatingKitchenAvailability, setUpdatingKitchenAvailability] = useState(false)
  const canManageKitchen = staffRole === 'manager' || staffRole === 'admin'
  const canOperateOrders = user?.email?.toLowerCase() === KITCHEN_EMAIL || staffRole === 'admin'

  const authorize = async (nextUser: User | null) => {
    if (!nextUser) { setUser(null); setStaffRole(null); setLoading(false); return false }
    if (nextUser.email?.toLowerCase() === KITCHEN_EMAIL) { setUser(nextUser); setStaffRole(null); setLoading(false); return true }
    const { data: profile } = await supabase.from('staff_profiles').select('role, active').eq('user_id', nextUser.id).maybeSingle()
    if (profile?.active && (profile.role === 'manager' || profile.role === 'admin')) { setUser(nextUser); setStaffRole(profile.role as StaffRole); setLoading(false); return true }
    await supabase.auth.signOut(); setLoginMessage('Esta cuenta no tiene acceso a la pantalla de cocina.'); setLoading(false); return false
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoginMessage('La conexión a Supabase no está configurada en esta aplicación.'); setLoading(false); return }
    void supabase.auth.getUser().then(({ data }) => void authorize(data.user))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void authorize(session?.user ?? null) })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    const loadOrders = async () => {
      const { data, error } = await supabase.from('orders').select('id, order_number, customer_name, customer_phone, order_type, delivery_address, delivery_reference, payment_status, status, total, notes, created_at, order_items(id, product_name, category, quantity, unit_price, notes)').in('status', ['nuevo', 'preparando', 'listo', 'en_camino']).or('payment_method.eq.cash,payment_status.eq.paid').order('created_at', { ascending: true })
      if (error) { setMessage('No se pudieron cargar los pedidos. Revisa tu conexión e intenta nuevamente.'); return }
      setOrders((data ?? []) as KitchenOrder[])
    }
    void loadOrders()
    const channel = supabase.channel('kitchen-orders-display').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => { if (payload.eventType === 'INSERT' && soundEnabled) playAlert(); void loadOrders() }).subscribe()
    return () => void supabase.removeChannel(channel)
  }, [soundEnabled, user])

  useEffect(() => {
    if (!user) return
    const loadKitchenAvailability = async () => {
      const { data } = await supabase.from('kitchen_status_public').select('manual_closed, force_open').eq('id', true).maybeSingle<KitchenAvailability>()
      if (data) setKitchenAvailability(data)
    }
    void loadKitchenAvailability()
    const channel = supabase.channel('kitchen-availability-display').on('postgres_changes', { event: '*', schema: 'public', table: 'kitchen_status_public' }, (payload) => {
      const status = payload.new as Partial<KitchenAvailability>
      setKitchenAvailability({ manual_closed: status.manual_closed === true, force_open: status.force_open === true })
    }).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user])

  useEffect(() => {
    const timer = window.setInterval(() => setScheduleOpen(isOnlineOrderingOpen()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoginMessage(''); setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email: KITCHEN_EMAIL, password })
    if (error || !data.user) { setLoginMessage('No se pudo ingresar. Revisa la contraseña de Cocina.'); setLoading(false); return }
    setPassword(''); await authorize(data.user)
  }

  const changeStatus = async (order: KitchenOrder, status: KitchenStatus) => {
    if (!canOperateOrders) return
    setUpdatingId(order.id); setMessage('')
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    if (error) setMessage('No se pudo actualizar el estado del pedido. Intenta nuevamente.')
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item).filter((item) => item.status !== 'entregado'))
    setUpdatingId(null)
  }

  const openRejection = (order: KitchenOrder) => { setRejectingOrder(order); setRejectionReason('Stock agotado'); setRejectionComment('') }
  const rejectOrder = async () => {
    if (!rejectingOrder) return
    setUpdatingId(rejectingOrder.id); setMessage('')
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) { setMessage('Tu sesión venció. Ingresa nuevamente.'); setUpdatingId(null); return }
    try {
      const response = await fetch('/.netlify/functions/reject-kitchen-order', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ orderId: rejectingOrder.id, reason: rejectionReason, comment: rejectionComment }) })
      const result = await response.json() as { rejected?: boolean; emailSent?: boolean; message?: string }
      if (!response.ok || !result.rejected) { setMessage(result.message ?? 'No fue posible rechazar el pedido.'); return }
      setOrders((current) => current.filter((order) => order.id !== rejectingOrder.id)); setRejectingOrder(null)
      setMessage(result.emailSent ? 'Pedido rechazado y correo enviado al cliente.' : 'Pedido rechazado. No se pudo enviar el correo al cliente.')
    } catch { setMessage('No se pudo conectar con el servicio de rechazo.') } finally { setUpdatingId(null) }
  }

  const updateKitchenAvailability = async (next: KitchenAvailability) => {
    if (!canManageKitchen) return
    setUpdatingKitchenAvailability(true); setMessage('')
    const { error } = await supabase.from('app_settings').update({ value: { manual_closed: next.manual_closed, force_open: next.force_open, reason: null }, updated_by: user?.id }).eq('key', 'kitchen_status')
    if (error) setMessage('No se pudo actualizar el estado de cocina. Intenta nuevamente.')
    setUpdatingKitchenAvailability(false)
  }
  const kitchenStateLabel = kitchenAvailability.manual_closed ? 'Cerrada manualmente' : kitchenAvailability.force_open ? 'Abierta manualmente' : scheduleOpen ? 'Abierta por horario' : 'Cerrada por horario'

  if (loading && !user) return <main className="kitchen-page"><p className="kitchen-loading">Cargando cocina...</p></main>
  if (!user) return <main className="kitchen-page kitchen-login-page"><section className="kitchen-login-card"><p className="eyebrow">The Black Cat · Cocina</p><h1>Pantalla de cocina</h1><p>Usuario: <strong>Cocina</strong></p><form onSubmit={submitLogin}><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button" type="submit">Ingresar</button></form>{loginMessage && <p className="kitchen-message error">{loginMessage}</p>}</section></main>

  return <main className="kitchen-page"><header className="kitchen-header"><div><p className="eyebrow">The Black Cat · Kitchen Display</p><h1>Cocina</h1><p>Usuario: <strong>{staffRole === 'admin' ? 'Administrador' : staffRole === 'manager' ? 'Manager' : 'Cocina'}</strong></p></div><div className="kitchen-header-actions"><label className="sound-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} /> Alerta sonora</label><button className="staff-secondary" type="button" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button></div></header>{canManageKitchen && <section className="kitchen-control-panel"><div><p className="eyebrow">PEDIDOS WEB</p><h2>Estado de cocina</h2><strong>{kitchenStateLabel}</strong></div><div className="kitchen-control-actions">{!kitchenAvailability.manual_closed && !kitchenAvailability.force_open && !scheduleOpen && <button className="primary-button" type="button" disabled={updatingKitchenAvailability} onClick={() => { if (window.confirm('¿Abrir pedidos web fuera del horario habitual?')) void updateKitchenAvailability({ manual_closed: false, force_open: true }) }}>Abrir cocina manualmente</button>}{(kitchenAvailability.manual_closed || kitchenAvailability.force_open) && <button className="staff-secondary" type="button" disabled={updatingKitchenAvailability} onClick={() => void updateKitchenAvailability({ manual_closed: false, force_open: false })}>Volver a horario automático</button>}{!kitchenAvailability.manual_closed && <button className="staff-danger" type="button" disabled={updatingKitchenAvailability} onClick={() => void updateKitchenAvailability({ manual_closed: true, force_open: false })}>Cerrar cocina</button>}</div></section>}{message && <p className="kitchen-message" role="status">{message}</p>}<section className="kitchen-board">{columns.map((column) => <section className="kitchen-column" key={column.status}><h2>{column.title}<span>{orders.filter((order) => order.status === column.status).length}</span></h2><div className="kitchen-card-list">{orders.filter((order) => order.status === column.status).map((order) => <KitchenOrderCard key={order.id} order={order} busy={updatingId === order.id} enabled={canOperateOrders} onChangeStatus={changeStatus} onReject={openRejection} />)}{orders.every((order) => order.status !== column.status) && <p className="kitchen-empty">Sin pedidos</p>}</div></section>)}</section><section className="kitchen-dispatch"><h2>Despacho</h2>{orders.filter((order) => order.status === 'en_camino').map((order) => <KitchenOrderCard key={order.id} order={order} busy={updatingId === order.id} enabled={canOperateOrders} onChangeStatus={changeStatus} onReject={openRejection} />)}{orders.every((order) => order.status !== 'en_camino') && <p className="kitchen-empty">No hay pedidos en camino.</p>}</section>{rejectingOrder && <div className="kitchen-modal-layer" role="presentation" onClick={() => !updatingId && setRejectingOrder(null)}><section className="kitchen-rejection-modal" role="dialog" aria-modal="true" aria-labelledby="rejection-title" onClick={(event) => event.stopPropagation()}><button type="button" className="close-button" aria-label="Cerrar" onClick={() => setRejectingOrder(null)} disabled={Boolean(updatingId)}>×</button><p className="eyebrow">PEDIDO #{rejectingOrder.order_number}</p><h2 id="rejection-title">Motivo del rechazo</h2><div className="rejection-reasons">{rejectionReasons.map((reason) => <label key={reason}><input type="radio" name="rejectionReason" checked={rejectionReason === reason} onChange={() => setRejectionReason(reason)} /> {reason}</label>)}</div><label className="rejection-comment">Comentario adicional <small>Opcional</small><textarea rows={3} maxLength={500} value={rejectionComment} onChange={(event) => setRejectionComment(event.target.value)} placeholder="Explica brevemente si es necesario" /></label><div className="rejection-actions"><button type="button" className="staff-secondary" disabled={Boolean(updatingId)} onClick={() => setRejectingOrder(null)}>Cancelar</button><button type="button" className="staff-danger" disabled={Boolean(updatingId)} onClick={() => void rejectOrder()}>{updatingId ? 'Rechazando...' : 'Confirmar rechazo'}</button></div></section></div>}</main>
}

function KitchenOrderCard({ order, busy, enabled, onChangeStatus, onReject }: { order: KitchenOrder; busy: boolean; enabled: boolean; onChangeStatus: (order: KitchenOrder, status: KitchenStatus) => void; onReject: (order: KitchenOrder) => void }) {
  const action = order.status === 'nuevo' ? { label: 'Aceptar pedido', status: 'preparando' as const } : order.status === 'preparando' ? { label: 'Marcar listo', status: 'listo' as const } : order.order_type === 'delivery' ? { label: 'En camino', status: 'en_camino' as const } : { label: 'Entregar pedido', status: 'entregado' as const }
  const isDispatch = order.status === 'en_camino'
  return <article className="kitchen-order-card"><div className="kitchen-order-heading"><strong>Pedido #{order.order_number}</strong><time>{formatTime(order.created_at)}</time></div><p className="kitchen-order-type">{order.order_type === 'delivery' ? 'Delivery' : 'Pick up'} · {order.payment_status === 'paid' ? 'Pagado' : 'Pago pendiente'}</p><p><b>{order.customer_name}</b><br />{order.customer_phone}</p>{order.order_type === 'delivery' && <p className="kitchen-address">{order.delivery_address}{order.delivery_reference ? ` · ${order.delivery_reference}` : ''}</p>}<ul className="kitchen-items">{order.order_items.map((item) => <li key={item.id}><span>{item.quantity} × {item.product_name}</span>{item.notes && <small>Nota: {item.notes}</small>}</li>)}</ul>{order.notes && <p className="kitchen-general-note">{order.notes}</p>}{enabled && <div className="kitchen-card-actions"><button className="primary-button" disabled={busy} onClick={() => onChangeStatus(order, isDispatch ? 'entregado' : action.status)}>{busy ? 'Actualizando...' : isDispatch ? 'Entregado' : action.label}</button>{order.status === 'nuevo' && <button className="staff-danger kitchen-reject-button" type="button" disabled={busy} onClick={() => onReject(order)}>Rechazar pedido</button>}</div>}</article>
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }

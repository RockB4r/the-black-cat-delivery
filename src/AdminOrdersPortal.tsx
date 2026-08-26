import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { StaffLogin } from './staff/StaffLogin'
import type { StaffProfile } from './staff/types'

type OrderStatus = 'nuevo' | 'preparando' | 'listo' | 'en_camino' | 'entregado' | 'rechazado' | 'cancelado'
type DateFilter = 'today' | 'yesterday' | 'last7' | 'custom'
type AdminOrder = {
  id: string
  order_number: string
  customer_name: string
  customer_email: string | null
  customer_phone: string
  order_type: 'delivery' | 'pick_up'
  delivery_address: string | null
  delivery_reference: string | null
  payment_method: 'cash' | 'card' | 'wallet' | string
  payment_status: string
  status: OrderStatus
  total: number
  notes: string | null
  created_at: string
  rejection_reason: string | null
  rejection_comment: string | null
  rejected_at: string | null
  rejected_by: string | null
}
type OrderItem = { id: string; product_name: string; category: string; quantity: number; unit_price: number; notes: string | null }

const orderFields = 'id, order_number, customer_name, customer_email, customer_phone, order_type, delivery_address, delivery_reference, payment_method, payment_status, status, total, notes, created_at, rejection_reason, rejection_comment, rejected_at, rejected_by'
const statusLabels: Record<OrderStatus, string> = { nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo', en_camino: 'En camino', entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado' }
const money = (value: number) => `S/ ${Number(value).toFixed(2)}`
const formatDate = (value: string) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const paymentLabel = (method: string) => ({ cash: 'Efectivo', card: 'Tarjeta', wallet: 'Yape/Plin' }[method] ?? method)
const orderTypeLabel = (type: string) => type === 'delivery' ? 'Delivery' : 'Pick Up'
const limaDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const limaMidnight = (date: string) => new Date(`${date}T00:00:00-05:00`).toISOString()

export function AdminOrdersPortal() {
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loadingAccess, setLoadingAccess] = useState(true)
  const [accessMessage, setAccessMessage] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [customStart, setCustomStart] = useState(limaDate())
  const [customEnd, setCustomEnd] = useState(limaDate())
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [ordersMessage, setOrdersMessage] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null)
  const [selectedItems, setSelectedItems] = useState<OrderItem[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadProfile = async (nextUser: User) => {
    const { data, error } = await supabase.from('staff_profiles').select('user_id, display_name, role, active').eq('user_id', nextUser.id).maybeSingle<StaffProfile>()
    if (error || !data || !data.active || (data.role !== 'manager' && data.role !== 'admin')) {
      await supabase.auth.signOut()
      setProfile(null); setUser(null)
      setAccessMessage('No tienes acceso a la administración de pedidos.')
      return
    }
    setProfile(data); setUser(nextUser); setAccessMessage('')
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setAccessMessage('Falta configurar Supabase para este acceso.'); setLoadingAccess(false); return }
    void supabase.auth.getUser().then(async ({ data }) => { if (data.user) await loadProfile(data.user); setLoadingAccess(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void (async () => { if (session?.user) await loadProfile(session.user); else { setProfile(null); setUser(null) }; setLoadingAccess(false) })() })
    return () => listener.subscription.unsubscribe()
  }, [])

  const range = useMemo(() => {
    const today = limaDate()
    if (dateFilter === 'yesterday') return { start: addDays(today, -1), end: today }
    if (dateFilter === 'last7') return { start: addDays(today, -6), end: addDays(today, 1) }
    if (dateFilter === 'custom') return { start: customStart, end: addDays(customEnd, 1) }
    return { start: today, end: addDays(today, 1) }
  }, [customEnd, customStart, dateFilter])

  useEffect(() => {
    if (!profile || !range.start || !range.end || (dateFilter === 'custom' && customStart > customEnd)) return
    let active = true
    const loadOrders = async () => {
      setLoadingOrders(true); setOrdersMessage('')
      let query = supabase.from('orders').select(orderFields).gte('created_at', limaMidnight(range.start)).lt('created_at', limaMidnight(range.end)).order('created_at', { ascending: false }).limit(500)
      if (statusFilter !== 'all') query = query.eq('status', statusFilter)
      if (typeFilter !== 'all') query = query.eq('order_type', typeFilter)
      if (paymentFilter !== 'all') query = query.eq('payment_method', paymentFilter)
      const { data, error } = await query
      if (!active) return
      if (error) { setOrders([]); setOrdersMessage('No se pudieron cargar los pedidos. Verifica tus permisos o conexión.') }
      else setOrders((data ?? []) as AdminOrder[])
      setLoadingOrders(false)
    }
    void loadOrders()
    return () => { active = false }
  }, [dateFilter, paymentFilter, profile, range.end, range.start, statusFilter, typeFilter, customEnd, customStart])

  const metrics = useMemo(() => {
    const validOrders = orders.filter((order) => order.status !== 'rechazado' && order.status !== 'cancelado' && (order.payment_method === 'cash' || order.payment_status === 'paid'))
    return {
      total: orders.length,
      sales: validOrders.reduce((sum, order) => sum + Number(order.total), 0),
      delivery: orders.filter((order) => order.order_type === 'delivery').length,
      pickup: orders.filter((order) => order.order_type === 'pick_up').length,
      rejected: orders.filter((order) => order.status === 'rechazado').length,
    }
  }, [orders])

  const openOrder = async (order: AdminOrder) => {
    setSelectedOrder(order); setSelectedItems([]); setLoadingDetail(true)
    const { data, error } = await supabase.from('order_items').select('id, product_name, category, quantity, unit_price, notes').eq('order_id', order.id).order('created_at', { ascending: true })
    if (error) setOrdersMessage('No se pudo cargar el detalle del pedido.')
    else setSelectedItems((data ?? []) as OrderItem[])
    setLoadingDetail(false)
  }

  const signIn = async (email: string, password: string) => {
    setLoadingAccess(true); setAccessMessage('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) { setAccessMessage('Correo o contraseña incorrectos.'); setLoadingAccess(false); return }
    await loadProfile(data.user); setLoadingAccess(false)
  }

  if (loadingAccess) return <main className="staff-page"><p className="staff-loading">Verificando acceso…</p></main>
  if (!profile || !user) return <StaffLogin onSubmit={signIn} message={accessMessage} loading={loadingAccess} />

  return <main className="admin-orders-page"><section className="admin-orders-shell"><header className="admin-orders-header"><div><p className="eyebrow">THE BLACK CAT · ADMINISTRACIÓN</p><h1>Pedidos Web</h1><p>{profile.display_name} · {profile.role === 'admin' ? 'Admin' : 'Manager'}</p></div><div className="admin-orders-header-actions"><a className="staff-secondary" href="/staff">Volver a staff</a><button className="staff-secondary" type="button" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button></div></header>
    <section className="admin-orders-filters" aria-label="Filtros de pedidos"><label>Fecha<select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)}><option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="last7">Últimos 7 días</option><option value="custom">Rango personalizado</option></select></label>{dateFilter === 'custom' && <><label>Desde<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>Hasta<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></>}<label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Modalidad<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos</option><option value="delivery">Delivery</option><option value="pick_up">Pick Up</option></select></label><label>Pago<select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="all">Todos</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="wallet">Yape/Plin</option></select></label></section>
    {dateFilter === 'custom' && customStart > customEnd && <p className="staff-warning">La fecha inicial no puede ser posterior a la fecha final.</p>}
    <section className="admin-order-metrics"><Metric label="Pedidos totales" value={String(metrics.total)} /><Metric label="Ventas web" value={money(metrics.sales)} /><Metric label="Delivery" value={String(metrics.delivery)} /><Metric label="Pick Up" value={String(metrics.pickup)} /><Metric label="Rechazados" value={String(metrics.rejected)} /></section>
    <section className="admin-orders-list"><div className="admin-orders-list-heading"><div><h2>Listado de pedidos</h2><p>{loadingOrders ? 'Cargando pedidos…' : `${orders.length} pedido(s) · más recientes primero`}</p></div></div>{ordersMessage && <p className="staff-message" role="status">{ordersMessage}</p>}{!loadingOrders && !orders.length && !ordersMessage && <p className="admin-orders-empty">No hay pedidos para estos filtros.</p>}<div className="admin-orders-table-wrap"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Modalidad</th><th>Pago</th><th>Total</th><th>Estado</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} tabIndex={0} onClick={() => void openOrder(order)} onKeyDown={(event) => { if (event.key === 'Enter') void openOrder(order) }}><td><strong>{order.order_number}</strong>{order.status === 'rechazado' && order.rejection_reason && <small>Motivo: {order.rejection_reason}</small>}</td><td>{formatDate(order.created_at)}</td><td>{order.customer_name}<small>{order.customer_phone}</small></td><td>{orderTypeLabel(order.order_type)}</td><td>{paymentLabel(order.payment_method)}<small>{order.payment_status === 'paid' ? 'Pagado' : 'Pago pendiente'}</small></td><td>{money(order.total)}</td><td><span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span></td></tr>)}</tbody></table></div><div className="admin-orders-cards">{orders.map((order) => <button type="button" className="admin-order-card" key={order.id} onClick={() => void openOrder(order)}><span>{formatDate(order.created_at)}</span><strong>{order.order_number}</strong><b>{order.customer_name}</b><small>{orderTypeLabel(order.order_type)} · {paymentLabel(order.payment_method)} · {money(order.total)} · {order.payment_status === 'paid' ? 'Pagado' : 'Pago pendiente'}</small><i className={`order-status status-${order.status}`}>{statusLabels[order.status]}</i>{order.status === 'rechazado' && order.rejection_reason && <em>Motivo: {order.rejection_reason}</em>}</button>)}</div></section>
    {selectedOrder && <div className="admin-order-modal-layer" role="presentation" onClick={() => setSelectedOrder(null)}><section className="admin-order-detail" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onClick={(event) => event.stopPropagation()}><button className="close-button" type="button" aria-label="Cerrar detalle" onClick={() => setSelectedOrder(null)}>×</button><p className="eyebrow">PEDIDO WEB</p><h2 id="order-detail-title">{selectedOrder.order_number}</h2><p className="admin-order-date">{formatDate(selectedOrder.created_at)}</p><div className="admin-order-detail-grid"><Detail label="Cliente" value={selectedOrder.customer_name} /><Detail label="Teléfono" value={selectedOrder.customer_phone} /><Detail label="Email" value={selectedOrder.customer_email || 'No proporcionado'} /><Detail label="Modalidad" value={orderTypeLabel(selectedOrder.order_type)} /><Detail label="Dirección" value={selectedOrder.order_type === 'delivery' ? selectedOrder.delivery_address || 'No proporcionada' : 'Recojo en local'} /><Detail label="Referencia" value={selectedOrder.delivery_reference || '—'} /><Detail label="Método de pago" value={paymentLabel(selectedOrder.payment_method)} /><Detail label="Estado de pago" value={selectedOrder.payment_status === 'paid' ? 'Pagado' : selectedOrder.payment_status} /><Detail label="Estado del pedido" value={statusLabels[selectedOrder.status]} /><Detail label="Total" value={money(selectedOrder.total)} /></div>{selectedOrder.notes && <section className="admin-order-notes"><h3>Notas generales</h3><p>{selectedOrder.notes}</p></section>}<section className="admin-order-items"><h3>Productos</h3>{loadingDetail ? <p>Cargando productos…</p> : selectedItems.length ? <ul>{selectedItems.map((item) => <li key={item.id}><div><strong>{item.quantity} × {item.product_name}</strong><span>{item.category}</span>{item.notes && <small>Nota / variante: {item.notes}</small>}</div><b>{money(item.unit_price)}</b></li>)}</ul> : <p>No se encontraron productos.</p>}</section>{selectedOrder.status === 'rechazado' && <section className="admin-order-rejection"><h3>Pedido rechazado</h3><Detail label="Motivo" value={selectedOrder.rejection_reason || '—'} /><Detail label="Comentario" value={selectedOrder.rejection_comment || '—'} /><Detail label="Fecha de rechazo" value={selectedOrder.rejected_at ? formatDate(selectedOrder.rejected_at) : '—'} /><Detail label="Rechazado por" value={selectedOrder.rejected_by || '—'} /></section>}</section></div>}</section></main>
}

function Metric({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article> }
function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }

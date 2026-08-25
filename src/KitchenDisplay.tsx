import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const KITCHEN_EMAIL = 'kitchen@theblackcatrockbar.com'

type KitchenStatus = 'nuevo' | 'preparando' | 'listo' | 'en_camino' | 'entregado' | 'cancelado'

type KitchenItem = {
  id: string
  product_name: string
  category: string
  quantity: number
  unit_price: number
  notes: string | null
}

type KitchenOrder = {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string
  order_type: 'delivery' | 'pick_up'
  delivery_address: string | null
  delivery_reference: string | null
  payment_status: string
  status: KitchenStatus
  total: number
  notes: string | null
  created_at: string
  order_items: KitchenItem[]
}

const columns: Array<{ title: string; status: KitchenStatus }> = [
  { title: 'Nuevos pedidos', status: 'nuevo' },
  { title: 'Preparando', status: 'preparando' },
  { title: 'Listos', status: 'listo' },
]

const playAlert = () => {
  try {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    ;[0, 0.24].forEach((startAt) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, context.currentTime + startAt)
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + startAt + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startAt + 0.17)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(context.currentTime + startAt)
      oscillator.stop(context.currentTime + startAt + 0.18)
    })
    window.setTimeout(() => void context.close(), 700)
  } catch {
    // Some browsers block audio until a user gesture. The display still refreshes.
  }
}

const formatTime = (date: string) => new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(date))

export function KitchenDisplay() {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [password, setPassword] = useState('')
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loginMessage, setLoginMessage] = useState('')
  const [message, setMessage] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const authorize = async (nextUser: User | null) => {
    if (!nextUser) {
      setUser(null)
      setIsAdmin(false)
      setLoading(false)
      return false
    }

    if (nextUser.email?.toLowerCase() === KITCHEN_EMAIL) {
      setUser(nextUser)
      setIsAdmin(false)
      setLoading(false)
      return true
    }

    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('role, active')
      .eq('user_id', nextUser.id)
      .maybeSingle()

    if (profile?.active && profile.role === 'admin') {
      setUser(nextUser)
      setIsAdmin(true)
      setLoading(false)
      return true
    }

    await supabase.auth.signOut()
    setLoginMessage('Esta cuenta no tiene acceso a la pantalla de cocina.')
    setLoading(false)
    return false
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoginMessage('La conexión a Supabase no está configurada en esta aplicación.')
      setLoading(false)
      return
    }

    void supabase.auth.getUser().then(({ data }) => void authorize(data.user))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void authorize(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return

    const loadOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, order_type, delivery_address, delivery_reference, payment_status, status, total, notes, created_at, order_items(id, product_name, category, quantity, unit_price, notes)')
        .in('status', ['nuevo', 'preparando', 'listo', 'en_camino'])
        .order('created_at', { ascending: true })
      if (error) {
        setMessage('No se pudieron cargar los pedidos. Revisa tu conexión e intenta nuevamente.')
        return
      }
      setOrders((data ?? []) as KitchenOrder[])
    }

    void loadOrders()
    const channel = supabase
      .channel('kitchen-orders-display')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'INSERT' && soundEnabled) playAlert()
        void loadOrders()
      })
      .subscribe()

    return () => void supabase.removeChannel(channel)
  }, [soundEnabled, user])

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginMessage('')
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email: KITCHEN_EMAIL, password })
    if (error || !data.user) {
      setLoginMessage('No se pudo ingresar. Revisa la contraseña de Cocina.')
      setLoading(false)
      return
    }
    setPassword('')
    await authorize(data.user)
  }

  const changeStatus = async (order: KitchenOrder, status: KitchenStatus) => {
    setUpdatingId(order.id)
    setMessage('')
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    if (error) setMessage('No se pudo actualizar el estado del pedido. Intenta nuevamente.')
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item).filter((item) => item.status !== 'entregado'))
    setUpdatingId(null)
  }

  if (loading && !user) return <main className="kitchen-page"><p className="kitchen-loading">Cargando cocina...</p></main>

  if (!user) {
    return <main className="kitchen-page kitchen-login-page"><section className="kitchen-login-card"><p className="eyebrow">The Black Cat · Cocina</p><h1>Pantalla de cocina</h1><p>Usuario: <strong>Cocina</strong></p><form onSubmit={submitLogin}><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button" type="submit">Ingresar</button></form>{loginMessage && <p className="kitchen-message error">{loginMessage}</p>}</section></main>
  }

  return <main className="kitchen-page"><header className="kitchen-header"><div><p className="eyebrow">The Black Cat · Kitchen Display</p><h1>Cocina</h1><p>Usuario: <strong>{isAdmin ? 'Administrador' : 'Cocina'}</strong></p></div><div className="kitchen-header-actions"><label className="sound-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} /> Alerta sonora</label><button className="staff-secondary" type="button" onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button></div></header>{message && <p className="kitchen-message error">{message}</p>}<section className="kitchen-board">{columns.map((column) => <section className="kitchen-column" key={column.status}><h2>{column.title}<span>{orders.filter((order) => order.status === column.status).length}</span></h2><div className="kitchen-card-list">{orders.filter((order) => order.status === column.status).map((order) => <KitchenOrderCard key={order.id} order={order} busy={updatingId === order.id} onChangeStatus={changeStatus} />)}{orders.every((order) => order.status !== column.status) && <p className="kitchen-empty">Sin pedidos</p>}</div></section>)}</section><section className="kitchen-dispatch"><h2>Despacho</h2>{orders.filter((order) => order.status === 'en_camino').map((order) => <KitchenOrderCard key={order.id} order={order} busy={updatingId === order.id} onChangeStatus={changeStatus} />)}{orders.every((order) => order.status !== 'en_camino') && <p className="kitchen-empty">No hay pedidos en camino.</p>}</section></main>
}

function KitchenOrderCard({ order, busy, onChangeStatus }: { order: KitchenOrder; busy: boolean; onChangeStatus: (order: KitchenOrder, status: KitchenStatus) => void }) {
  const action = order.status === 'nuevo' ? { label: 'Aceptar pedido', status: 'preparando' as const } : order.status === 'preparando' ? { label: 'Marcar listo', status: 'listo' as const } : order.order_type === 'delivery' ? { label: 'En camino', status: 'en_camino' as const } : { label: 'Entregar pedido', status: 'entregado' as const }
  const isDispatch = order.status === 'en_camino'
  return <article className="kitchen-order-card"><div className="kitchen-order-heading"><strong>Pedido #{order.order_number}</strong><time>{formatTime(order.created_at)}</time></div><p className="kitchen-order-type">{order.order_type === 'delivery' ? 'Delivery' : 'Pick up'} · {order.payment_status === 'paid' ? 'Pagado' : 'Pago pendiente'}</p><p><b>{order.customer_name}</b><br />{order.customer_phone}</p>{order.order_type === 'delivery' && <p className="kitchen-address">{order.delivery_address}{order.delivery_reference ? ` · ${order.delivery_reference}` : ''}</p>}<ul className="kitchen-items">{order.order_items.map((item) => <li key={item.id}><span>{item.quantity} × {item.product_name}</span>{item.notes && <small>Nota: {item.notes}</small>}</li>)}</ul>{order.notes && <p className="kitchen-general-note">{order.notes}</p>}<button className="primary-button" disabled={busy} onClick={() => onChangeStatus(order, isDispatch ? 'entregado' : action.status)}>{busy ? 'Actualizando...' : isDispatch ? 'Entregado' : action.label}</button></article>
}

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext }
}

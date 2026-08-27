import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import menuData from './data/menu.json'
import type { MenuCategory } from './data/types'
import { productKey } from './data/productKeys'
import { supabase } from './lib/supabase'
import type { StaffRole } from './staff/types'

type AvailabilityRow = { product_key: string; is_available: boolean }

const menuCategories = menuData as MenuCategory[]

export function ProductAvailabilityPanel({ user, role }: { user: User; role: StaffRole | null }) {
  const [availability, setAvailability] = useState<Record<string, boolean>>({})
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const loadAvailability = async () => {
      const { data, error } = await supabase.from('product_availability').select('product_key, is_available')
      if (error || !active) return
      setAvailability(Object.fromEntries((data as AvailabilityRow[]).map((item) => [item.product_key, item.is_available])))
    }
    void loadAvailability()
    const channel = supabase.channel('kitchen-product-availability').on('postgres_changes', { event: '*', schema: 'public', table: 'product_availability' }, (payload) => {
      const row = payload.new as Partial<AvailabilityRow>
      const key = row.product_key
      const isAvailable = row.is_available
      if (typeof key === 'string' && typeof isAvailable === 'boolean') setAvailability((current) => ({ ...current, [key]: isAvailable }))
    }).subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [])

  const updateAvailability = async (name: string) => {
    const key = productKey(name)
    if (!key || updatingKey) return
    const isAvailable = availability[key] !== false
    const nextAvailable = !isAvailable
    if (!window.confirm(`¿Marcar ${name} como ${nextAvailable ? 'disponible' : 'agotado'}?`)) return
    setUpdatingKey(key); setMessage('')
    const { error } = await supabase.from('product_availability').update({ is_available: nextAvailable, updated_by: user.id }).eq('product_key', key)
    if (error) setMessage('No se pudo actualizar la disponibilidad. Inténtalo nuevamente.')
    else setAvailability((current) => ({ ...current, [key]: nextAvailable }))
    setUpdatingKey(null)
  }

  return <section className="product-availability-panel">
    <div><p className="eyebrow">OPERACIÓN</p><h2>Disponibilidad de productos</h2><p>Marca un producto como agotado para retirarlo temporalmente de pedidos web.</p></div>
    {message && <p className="kitchen-message error" role="status">{message}</p>}
    <div className="product-availability-categories">{menuCategories.map((category) => <section key={category.id}><h3>{category.name}</h3><div>{category.items.map((item) => {
      const key = productKey(item.name)
      const isAvailable = key ? availability[key] !== false : true
      return <article key={item.name}><span>{item.name}</span><button type="button" disabled={!key || updatingKey === key} className={isAvailable ? 'availability-button available' : 'availability-button unavailable'} onClick={() => void updateAvailability(item.name)}>{updatingKey === key ? 'Actualizando…' : isAvailable ? 'Disponible' : 'Agotado'}</button></article>
    })}</div></section>)}</div>
    {role === 'manager' || role === 'admin' ? <small>Los cambios quedan registrados con tu usuario.</small> : <small>Los cambios quedan registrados con el usuario de Cocina.</small>}
  </section>
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseGiftCardOperations } from '../lib/giftCardOperations'
import type { GiftCardOperations } from '../lib/giftCardOperations'

export function GiftCardOperationsPanel({ userId }: { userId: string }) {
  const [flags, setFlags] = useState<GiftCardOperations | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'gift_card_operations').maybeSingle()
      const state = error ? null : parseGiftCardOperations(data?.value)
      setFlags(state)
      setMessage(state ? '' : 'Estado no verificable: nuevas operaciones bloqueadas por seguridad.')
    } catch { setFlags(null); setMessage('Estado no verificable: nuevas operaciones bloqueadas por seguridad.') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const toggle = async (key: keyof GiftCardOperations) => {
    if (!flags || busy) return
    if (!window.confirm(`¿Confirmar ${flags[key] ? 'suspensión' : 'habilitación'}? No se cancelarán pagos ya iniciados.`)) return
    setBusy(true)
    try {
      // Change only the selected flag through an authenticated, audited RPC.
      const { error } = await supabase.rpc('set_gift_card_operation', { p_flag: key, p_enabled: !flags[key] })
      if (error) throw error
      await load()
    } catch { setMessage('No se pudo cambiar el estado. Actualiza para verificarlo.'); setBusy(false) }
  }
  return <section className="staff-section" aria-label="Control de operaciones Gift Cards">
    <h2>Operaciones Gift Cards</h2>
    <p>Ventas públicas: {flags?.gift_card_sales_enabled ? 'Habilitadas' : 'Suspendidas / no verificadas'} · Nuevos pagos y canjes: {flags?.gift_card_redemption_enabled ? 'Habilitados' : 'Suspendidos / no verificados'}</p>
    <p>Webhook y conciliación de pagos existentes siguen activos. Los canjes presenciales también se suspenden.</p>
    <div className="staff-actions">
      <button type="button" disabled={busy || !flags} onClick={() => void toggle('gift_card_sales_enabled')}>{flags?.gift_card_sales_enabled ? 'Suspender ventas públicas' : 'Habilitar ventas públicas'}</button>
      <button type="button" disabled={busy || !flags} onClick={() => void toggle('gift_card_redemption_enabled')}>{flags?.gift_card_redemption_enabled ? 'Suspender pagos y canjes' : 'Habilitar pagos y canjes'}</button>
      <button type="button" disabled={busy} onClick={() => void load()}>Actualizar estado</button>
    </div>
    {message && <p role="status">{message}</p>}
    <small>Cambios auditados para el usuario autenticado {userId ? 'actual' : '(sesión requerida)'}.</small>
  </section>
}

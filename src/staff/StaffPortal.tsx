import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { StaffDashboard } from './StaffDashboard'
import { StaffLogin } from './StaffLogin'
import type { StaffProfile } from './types'

export function StaffPortal() {
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const loadProfile = async (user: User) => {
    const { data, error } = await supabase.from('staff_profiles').select('display_name, role, active').eq('user_id', user.id).maybeSingle<StaffProfile>()
    if (error || !data) { await supabase.auth.signOut(); setMessage('No tienes acceso al portal de staff.'); setProfile(null); setUser(null); return }
    if (!data.active) { await supabase.auth.signOut(); setMessage('Usuario desactivado.'); setProfile(null); setUser(null); return }
    setProfile(data)
    setUser(user)
    setMessage('')
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setMessage('Falta configurar Supabase para el portal de staff.'); setLoading(false); return }
    void supabase.auth.getUser().then(async ({ data }) => { if (data.user) await loadProfile(data.user); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { void (async () => { if (session?.user) await loadProfile(session.user); else { setProfile(null); setUser(null) }; setLoading(false) })() })
    return () => listener.subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    setLoading(true); setMessage('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) { setMessage('Correo o contraseña incorrectos.'); setLoading(false); return }
    await loadProfile(data.user); setLoading(false)
  }

  if (loading) return <main className="staff-page"><p className="staff-loading">Cargando acceso…</p></main>
  return profile && user ? <StaffDashboard profile={profile} userId={user.id} onSignOut={async () => { await supabase.auth.signOut(); setProfile(null); setUser(null) }} /> : <StaffLogin onSubmit={signIn} message={message} loading={loading} />
}

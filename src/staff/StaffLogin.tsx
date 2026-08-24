import { useState } from 'react'

type Props = { onSubmit: (email: string, password: string) => Promise<void>; message?: string; loading: boolean }

export function StaffLogin({ onSubmit, message, loading }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return <main className="staff-page"><section className="staff-card">
    <p className="eyebrow">THE BLACK CAT · STAFF</p><h1>Acceso privado</h1>
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(email, password) }}>
      <label>Correo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
      <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
      {message && <p className="staff-message" role="status">{message}</p>}
      <button className="checkout-button" disabled={loading} type="submit">{loading ? 'Ingresando…' : 'Ingresar'}</button>
    </form>
  </section></main>
}

export type Authentication3DS = { eci: string; xid: string; cavv: string; protocolVersion: string; directoryServerTransactionId?: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export const validDeviceFingerprint = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
export const parseAuthentication3DS = (value: unknown): Authentication3DS | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const p = value as Record<string, unknown>
  if (Object.keys(p).some(k => !['eci', 'xid', 'cavv', 'protocolVersion', 'directoryServerTransactionId'].includes(k))
    || typeof p.eci !== 'string' || !/^(02|05)$/.test(p.eci)
    || typeof p.xid !== 'string' || !/^[A-Za-z0-9+/=_-]{1,256}$/.test(p.xid)
    || typeof p.cavv !== 'string' || !/^[A-Za-z0-9+/=_-]{1,256}$/.test(p.cavv)
    || typeof p.protocolVersion !== 'string' || !/^[12]\.\d{1,2}\.\d{1,2}$/.test(p.protocolVersion)) return null
  const ds = p.directoryServerTransactionId
  if ((p.protocolVersion.startsWith('2.') || ds != null) && (typeof ds !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(ds))) return null
  return { eci: p.eci, xid: p.xid, cavv: p.cavv, protocolVersion: p.protocolVersion, ...(typeof ds === 'string' ? { directoryServerTransactionId: ds } : {}) }
}

export type ThreeDSApi = {
  publicKey: string
  settings: { charge: { totalAmount: number; currency: 'PEN'; returnUrl: string }; card: { email: string } }
  options?: { closeModalAction: () => void }
  generateDevice: () => Promise<string | null>
  initAuthentication: (token: string) => void
  reset: () => void
}

// Listener lives only for the active operation. It cannot submit twice or resume after refresh.
export const authenticateMixedPayment = (sdk: ThreeDSApi, token: string, active: () => boolean,
  target: Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'> = window,
  timeoutMs = 120_000): Promise<Authentication3DS> => new Promise((resolve, reject) => {
  let finished = false
  const finish = (parameters: Authentication3DS | null) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    target.removeEventListener('message', listener)
    target.removeEventListener('pagehide', cancel)
    if (parameters && active()) resolve(parameters)
    else reject(new Error('3DS_CANCELLED_OR_UNVERIFIED'))
  }
  const cancel = () => finish(null)
  const listener = (event: MessageEvent) => {
    if (!active() || event.origin !== target.location.origin || !event.data || typeof event.data !== 'object') return
    if (event.data.error) finish(null)
    else if (event.data.parameters3DS) finish(parseAuthentication3DS(event.data.parameters3DS))
  }
  const timer = setTimeout(cancel, timeoutMs)
  sdk.options = { closeModalAction: cancel }
  target.addEventListener('message', listener)
  target.addEventListener('pagehide', cancel)
  try { sdk.initAuthentication(token) } catch { finish(null) }
})

let loading: Promise<ThreeDSApi> | undefined
export const loadCulqi3DS = (): Promise<ThreeDSApi> => {
  if (window.Culqi3DS) return Promise.resolve(window.Culqi3DS)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://3ds.culqi.com'
    script.async = true
    script.onload = () => {
      if (window.Culqi3DS) { script.dataset.culqi3ds = 'ready'; resolve(window.Culqi3DS) }
      else reject(new Error('3DS_UNAVAILABLE'))
    }
    script.onerror = () => reject(new Error('3DS_UNAVAILABLE'))
    document.head.appendChild(script)
  })
  return loading
}

import { createHash, randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'

export const memberSessionCookie = 'tbc_member_session'
const sessionLifetimeSeconds = 30 * 60
const sessions = () => getStore({ name: 'the-black-cat-member-sessions', consistency: 'strong' })
const attempts = () => getStore({ name: 'the-black-cat-member-login-limits', consistency: 'strong' })

type MemberSession = { memberId: string; expiresAt: string }
type LoginAttempt = { count: number; resetAt: number }

export const serverHeaders = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra })

export const getCookie = (request: Request, name: string) => {
  const value = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
  try { return value ? decodeURIComponent(value) : '' } catch { return '' }
}

export const sessionCookie = (request: Request, sessionId: string) => `${memberSessionCookie}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeSeconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
export const clearSessionCookie = (request: Request) => `${memberSessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`

export const createMemberSession = async (memberId: string) => {
  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString()
  await sessions().setJSON<MemberSession>(sessionId, { memberId, expiresAt }, { onlyIfNew: true })
  return sessionId
}

export const readMemberSession = async (request: Request) => {
  const sessionId = getCookie(request, memberSessionCookie)
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null
  const session = await sessions().getJSON<MemberSession>(sessionId, { consistency: 'strong' })
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) await sessions().delete(sessionId)
    return null
  }
  return { sessionId, memberId: session.memberId }
}

export const deleteMemberSession = async (request: Request) => {
  const sessionId = getCookie(request, memberSessionCookie)
  if (/^[0-9a-f-]{36}$/i.test(sessionId)) await sessions().delete(sessionId)
}

const attemptKey = (request: Request) => {
  const address = request.headers.get('x-nf-client-connection-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  return createHash('sha256').update(address).digest('hex')
}

export const checkLoginLimit = async (request: Request) => {
  const key = attemptKey(request)
  const attempt = await attempts().getJSON<LoginAttempt>(key, { consistency: 'strong' })
  if (!attempt || attempt.resetAt <= Date.now()) return { allowed: true, key }
  return { allowed: attempt.count < 5, key, retryAfter: Math.ceil((attempt.resetAt - Date.now()) / 1000) }
}

export const recordFailedLogin = async (key: string) => {
  const current = await attempts().getJSON<LoginAttempt>(key, { consistency: 'strong' })
  const active = current && current.resetAt > Date.now() ? current : { count: 0, resetAt: Date.now() + 15 * 60 * 1000 }
  await attempts().setJSON(key, { ...active, count: active.count + 1 })
}

export const clearLoginLimit = async (key: string) => attempts().delete(key)

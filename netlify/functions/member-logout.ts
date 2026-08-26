import { clearSessionCookie, deleteMemberSession } from '../lib/member-portal'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  await deleteMemberSession(request)
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie(request), 'cache-control': 'no-store' } })
}

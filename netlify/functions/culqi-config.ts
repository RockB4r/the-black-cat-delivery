import { getCulqiEnvironment } from '../lib/culqi-verification'

// Public, non-secret capability: the backend remains the authority.
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  const environment = getCulqiEnvironment()
  return Response.json(environment ? { environment } : { message: 'Pago no disponible.' }, {
    status: environment ? 200 : 503, headers: { 'cache-control': 'no-store' },
  })
}

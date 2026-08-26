import { getOnlineOrderingAvailability } from '../lib/online-ordering'
import { json } from '../lib/request'

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json(405, { message: 'Método no permitido.' })

  const availability = await getOnlineOrderingAvailability()
  return json(200, { manualClosed: availability.manuallyClosed, forceOpen: availability.forceOpen })
}

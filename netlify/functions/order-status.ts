import { getOrder } from '../lib/orders'
import { json } from '../lib/request'

export default async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const orderId = url.searchParams.get('orderId') ?? ''
  const email = url.searchParams.get('email') ?? ''
  if (!/^TBC-\d{8}-[A-Z0-9]{6}$/.test(orderId) || !email) return json(400, { message: 'Solicitud no válida.' })
  const order = await getOrder(orderId)
  if (!order || order.email.toLowerCase() !== email.toLowerCase()) return json(404, { message: 'Pedido no encontrado.' })
  return json(200, { orderId: order.orderId, paymentStatus: order.paymentStatus })
}

import { getGiftPurchase } from '../lib/gift-cards.ts'
import { buildGiftChargeDiagnostic, checkoutIdFromDiagnosticCharge, diagnosticChargeId } from '../lib/gift-card-charge-diagnostic.ts'

const stagingSiteId = '9c0fe271-da6d-4ff2-a7ab-3f0743ccecae'
const stagingSupabaseHost = ['kqfphrukxdvlrbjipjnx', 'supabase', 'co'].join('.')
const usesStagingSupabase = (): boolean => {
  try { return new URL(process.env.SUPABASE_URL ?? '').hostname === stagingSupabaseHost }
  catch { return false }
}

const response = (status: number, body: unknown): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
})

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return response(405, { message: 'Método no permitido.' })
  if (process.env.SITE_ID !== stagingSiteId || !usesStagingSupabase()) {
    return response(404, { message: 'No disponible.' })
  }
  const secretKey = process.env.CULQI_SECRET_KEY
  if (!secretKey?.startsWith('sk_test_')) return response(503, { message: 'Culqi TEST no está configurado.' })

  try {
    const culqiResponse = await fetch(`https://api.culqi.com/v2/charges/${diagnosticChargeId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${secretKey}` },
    })
    if (!culqiResponse.ok) return response(502, { message: `La consulta Culqi TEST devolvió HTTP ${culqiResponse.status}.` })
    const charge: unknown = await culqiResponse.json().catch(() => null)
    if (!charge || typeof charge !== 'object') return response(502, { message: 'Culqi TEST no devolvió un cargo JSON válido.' })
    const checkoutId = checkoutIdFromDiagnosticCharge(charge)
    const purchase = checkoutId ? await getGiftPurchase(checkoutId) : null
    return response(200, buildGiftChargeDiagnostic(charge, purchase))
  } catch {
    return response(502, { message: 'No se pudo completar el diagnóstico.' })
  }
}

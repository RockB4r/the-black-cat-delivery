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

const sanitizeCulqiError = (body: string): string => {
  let parsed: unknown
  try { parsed = JSON.parse(body) }
  catch { return '[respuesta no JSON omitida por seguridad]' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '[respuesta no estructurada omitida por seguridad]'

  const root = parsed as Record<string, unknown>
  const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown> : root
  const safe: Record<string, string | number> = {}
  for (const field of ['type', 'code', 'param', 'merchant_message', 'user_message', 'message']) {
    const value = error[field]
    if (typeof value === 'number') safe[field] = value
    if (typeof value === 'string') {
      safe[field] = value.slice(0, 500)
        .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+\b/gi, '[CLAVE REDACTADA]')
        .replace(/\b(?:tkn|ype|crd|src)_(?:test|live)_[A-Za-z0-9_-]+\b/gi, '[TOKEN REDACTADO]')
        .replace(/Bearer\s+\S+/gi, '[AUTORIZACIÓN REDACTADA]')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL REDACTADO]')
        .replace(/(?:\+?\d[\s().-]?){9,19}\d/g, '[NÚMERO REDACTADO]')
        .replace(/\b(?:nombre|name|direcci[oó]n|address)\s*[:=]\s*[^,;]+/gi, '[DATO PERSONAL REDACTADO]')
    }
  }
  return Object.keys(safe).length ? JSON.stringify(safe).slice(0, 600) : '[sin campos de error seguros]'
}

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
    if (!culqiResponse.ok) {
      const errorBody = await culqiResponse.text()
      return response(502, { culqi_status: culqiResponse.status, culqi_error: sanitizeCulqiError(errorBody) })
    }
    const charge: unknown = await culqiResponse.json().catch(() => null)
    if (!charge || typeof charge !== 'object') return response(502, { message: 'Culqi TEST no devolvió un cargo JSON válido.' })
    const checkoutId = checkoutIdFromDiagnosticCharge(charge)
    const purchase = checkoutId ? await getGiftPurchase(checkoutId) : null
    return response(200, buildGiftChargeDiagnostic(charge, purchase))
  } catch {
    return response(502, { message: 'No se pudo completar el diagnóstico.' })
  }
}

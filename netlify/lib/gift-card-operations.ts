import { parseGiftCardOperations } from '../../src/lib/giftCardOperations.ts'

// Admission checks only. Never call from webhook, finalization, status or reconciliation.
export const giftCardOperationBlock = async (operation: 'sales' | 'redemption'): Promise<Response | null> => {
  const unavailable = () => Response.json({ code: 'GIFT_CARD_SETTINGS_UNAVAILABLE', message: 'No se pudo verificar la disponibilidad de Gift Cards. No inicies otro pago; consulta el estado de tu operación.' }, { status: 503 })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return unavailable()
  try {
    const response = await fetch(`${url}/rest/v1/app_settings?key=eq.gift_card_operations&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return unavailable()
    const rows: unknown = await response.json()
    const flags = Array.isArray(rows) && rows.length === 1 ? parseGiftCardOperations(rows[0]?.value) : null
    if (!flags) return unavailable()
    if (flags[operation === 'sales' ? 'gift_card_sales_enabled' : 'gift_card_redemption_enabled']) return null
    return Response.json({ code: operation === 'sales' ? 'GIFT_CARD_SALES_SUSPENDED' : 'GIFT_CARD_REDEMPTION_SUSPENDED', message: operation === 'sales' ? 'Las nuevas compras de Gift Cards están suspendidas temporalmente.' : 'Los nuevos pagos y canjes con Gift Card están suspendidos temporalmente. Los pagos ya iniciados siguen en verificación.' }, { status: 503 })
  } catch { return unavailable() }
}

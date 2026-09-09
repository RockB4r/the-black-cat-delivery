export type AppliedPromotion = {
  code: string
  discountPercent: number
  minimumSubtotal: number
  discountAmount: number
  total: number
  reservedUntil: string
}

type PromotionReservationRow = {
  accepted: boolean
  reason: string
  code: string | null
  discount_percent: number | string | null
  minimum_subtotal: number | string | null
  discount_amount: number | string | null
  total: number | string | null
  reserved_until: string | null
}

const serverConfig = () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase server environment is incomplete.')
  return { url, key }
}

const numeric = (value: number | string | null) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN

export const normalizePromotionCode = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '') : ''

export const reservePromotion = async ({ code, checkoutId, email, phone, subtotal }: { code: string; checkoutId: string; email: string; phone: string; subtotal: number }) => {
  const { url, key } = serverConfig()
  const response = await fetch(`${url}/rest/v1/rpc/reserve_promotion_code`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_code: normalizePromotionCode(code), p_checkout_id: checkoutId, p_customer_email: email.trim().toLowerCase(), p_customer_phone: phone, p_subtotal: subtotal }),
  })
  const rows: unknown = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') throw new Error(`Promotion reservation failed with HTTP ${response.status}`)
  const row = rows[0] as PromotionReservationRow
  if (!row.accepted || !row.code) return { accepted: false as const, reason: row.reason || 'not_available' }
  const discountPercent = numeric(row.discount_percent)
  const minimumSubtotal = numeric(row.minimum_subtotal)
  const discountAmount = numeric(row.discount_amount)
  const total = numeric(row.total)
  if (![discountPercent, minimumSubtotal, discountAmount, total].every(Number.isFinite) || !row.reserved_until) throw new Error('Promotion reservation returned invalid data.')
  return { accepted: true as const, promotion: { code: row.code, discountPercent, minimumSubtotal, discountAmount, total, reservedUntil: row.reserved_until } satisfies AppliedPromotion }
}

export const getReservedPromotion = async ({ checkoutId, code, email, phone, subtotal }: { checkoutId: string; code: string; email: string; phone: string; subtotal: number }): Promise<AppliedPromotion | null> => {
  const result = await reservePromotion({ checkoutId, code, email, phone, subtotal })
  return result.accepted ? result.promotion : null
}

export const confirmPromotionUse = async ({ checkoutId, orderId }: { checkoutId: string; orderId: string }) => {
  const { url, key } = serverConfig()
  const response = await fetch(`${url}/rest/v1/promotion_redemptions?checkout_id=eq.${encodeURIComponent(checkoutId)}&status=eq.reserved`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'used', order_number: orderId, used_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`Promotion confirmation failed with HTTP ${response.status}`)
}

export const releasePromotion = async (checkoutId: string) => {
  const { url, key } = serverConfig()
  const response = await fetch(`${url}/rest/v1/promotion_redemptions?checkout_id=eq.${encodeURIComponent(checkoutId)}&status=eq.reserved`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'released', updated_at: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`Promotion release failed with HTTP ${response.status}`)
}

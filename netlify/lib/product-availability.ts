import type { OrderItem } from './orders'
import { productKey } from '../../src/data/productKeys'

export class ProductAvailabilityError extends Error {
  constructor() {
    super('Product availability could not be verified.')
  }
}

export const getUnavailableProducts = async (items: OrderItem[]) => {
  const keys = [...new Set(items.map((item) => productKey(item.name)))]
  if (keys.some((key) => !key)) throw new ProductAvailabilityError()

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new ProductAvailabilityError()

  const response = await fetch(`${url}/rest/v1/product_availability?product_key=in.(${keys.map(encodeURIComponent).join(',')})&is_available=eq.false&select=product_key`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!response.ok) throw new ProductAvailabilityError()

  const rows: unknown = await response.json().catch(() => null)
  const unavailableKeys = new Set(Array.isArray(rows) ? rows.flatMap((row) => {
    const data = row && typeof row === 'object' ? row as { product_key?: unknown } : null
    return typeof data?.product_key === 'string' ? [data.product_key] : []
  }) : [])
  return [...new Set(items.filter((item) => unavailableKeys.has(productKey(item.name))).map((item) => item.name))]
}

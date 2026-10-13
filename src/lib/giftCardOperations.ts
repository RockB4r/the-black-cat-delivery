export type GiftCardOperations = { gift_card_sales_enabled: boolean; gift_card_redemption_enabled: boolean }

export const parseGiftCardOperations = (value: unknown): GiftCardOperations | null => {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return typeof data.gift_card_sales_enabled === 'boolean' && typeof data.gift_card_redemption_enabled === 'boolean'
    ? { gift_card_sales_enabled: data.gift_card_sales_enabled, gift_card_redemption_enabled: data.gift_card_redemption_enabled }
    : null
}

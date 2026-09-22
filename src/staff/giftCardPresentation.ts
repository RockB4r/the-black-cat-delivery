export type GiftCardStatus = 'pending' | 'active' | 'exhausted' | 'expired' | 'blocked'
export type GiftCardSection = 'active' | 'blocked' | 'finished' | 'pending'

export type PresentableGiftCard = { status: GiftCardStatus; expires_at: string | null }

export const effectiveGiftCardStatus = (card: PresentableGiftCard, now = Date.now()): GiftCardStatus =>
  card.status === 'active' && card.expires_at && new Date(card.expires_at).getTime() <= now ? 'expired' : card.status

export const giftCardSection = (card: PresentableGiftCard, now = Date.now()): GiftCardSection => {
  const status = effectiveGiftCardStatus(card, now)
  return status === 'exhausted' || status === 'expired' ? 'finished' : status
}

export const groupGiftCards = <T extends PresentableGiftCard>(cards: T[], now = Date.now()) => {
  const groups: Record<GiftCardSection, T[]> = { active: [], blocked: [], finished: [], pending: [] }
  const counts: Record<GiftCardStatus, number> = { active: 0, blocked: 0, exhausted: 0, expired: 0, pending: 0 }
  for (const card of cards) {
    counts[effectiveGiftCardStatus(card, now)] += 1
    groups[giftCardSection(card, now)].push(card)
  }
  return { groups, counts }
}

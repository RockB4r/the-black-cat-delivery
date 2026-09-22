import type { StaffRole } from './types'

export const canManageGiftCards = (role: StaffRole) => role === 'manager' || role === 'admin'

export const canUnblockGiftCard = (
  role: StaffRole,
  card: { status: string; current_balance: number; expires_at: string | null },
  now = Date.now(),
) => canManageGiftCards(role)
  && card.status === 'blocked'
  && Number(card.current_balance) > 0
  && card.expires_at !== null
  && new Date(card.expires_at).getTime() > now

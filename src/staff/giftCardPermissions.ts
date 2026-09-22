import type { StaffRole } from './types'

export const canManageGiftCards = (role: StaffRole) => role === 'manager' || role === 'admin'

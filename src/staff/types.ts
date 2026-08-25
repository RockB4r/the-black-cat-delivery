export type StaffRole = 'staff' | 'manager' | 'admin'

export type StaffProfile = {
  user_id: string
  display_name: string
  role: StaffRole
  active: boolean
}

export type Member = {
  id: string
  document_type: 'DNI' | 'CE' | null
  document_number: string | null
  dni?: string | null
  full_name: string
  phone: string | null
  email: string | null
  birth_date: string | null
  joined_at: string
  points_balance: number
  status: string
  marketing_consent: boolean
}

export type RewardCategory = 'craft_beer' | 'cocktail' | 'burger' | 'sandwich' | 'wings' | 'wrap'
export type ReceiptType = 'boleta' | 'factura'

export type Consumption = {
  id: string
  member_id: string
  amount: number
  points_earned: number
  receipt_type: ReceiptType
  receipt_series: string
  receipt_number: string
  status: 'active' | 'reversed'
  registered_by: string
  consumed_at: string
}

export type ConsumptionAudit = {
  id?: string
  consumption_id: string
  action: 'correction' | 'reversal' | string
  old_amount: number | null
  new_amount: number | null
  points_adjusted: number | null
  reason: string
  performed_by: string
  created_at: string
}

export type PointMovement = {
  id: string
  member_id: string
  points: number
  movement_type: string
  source_type: string
  source_id: string | null
  description: string
  registered_by: string
  created_at: string
}

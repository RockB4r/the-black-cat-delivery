export type StaffRole = 'staff' | 'manager' | 'admin'

export type StaffProfile = {
  display_name: string
  role: StaffRole
  active: boolean
}

export type Member = {
  id: string
  dni: string
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

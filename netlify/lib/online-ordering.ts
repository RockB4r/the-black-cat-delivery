import { isOnlineOrderingOpen, onlineOrderingHours } from '../../src/lib/onlineOrdering'

export { isOnlineOrderingOpen, onlineOrderingHours }

type KitchenStatusRow = {
  value?: {
    manual_closed?: boolean
  }
}

export type OnlineOrderingAvailability = {
  isOpen: boolean
  manuallyClosed: boolean
  message?: string
}

const temporarilyClosedMessage = 'Cocina cerrada temporalmente. Intenta nuevamente más tarde.'

async function isKitchenManuallyClosed() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) throw new Error('Missing server-side Supabase configuration for kitchen status')

  const response = await fetch(`${url}/rest/v1/app_settings?key=eq.kitchen_status&select=value`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  if (!response.ok) throw new Error(`Kitchen status query failed with HTTP ${response.status}`)

  const rows = await response.json() as KitchenStatusRow[]
  return rows[0]?.value?.manual_closed === true
}

export async function getOnlineOrderingAvailability(): Promise<OnlineOrderingAvailability> {
  try {
    if (await isKitchenManuallyClosed()) {
      return { isOpen: false, manuallyClosed: true, message: temporarilyClosedMessage }
    }
  } catch (error) {
    console.error('Unable to verify the manual kitchen status.', error)
    // Fail closed: do not accept an order when the manual closure setting cannot be verified.
    return { isOpen: false, manuallyClosed: true, message: temporarilyClosedMessage }
  }

  if (!isOnlineOrderingOpen()) {
    return {
      isOpen: false,
      manuallyClosed: false,
      message: `Cocina Cerrada. Nuestro horario de atención online es: ${onlineOrderingHours.display}.`,
    }
  }

  return { isOpen: true, manuallyClosed: false }
}

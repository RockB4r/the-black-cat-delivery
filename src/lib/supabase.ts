import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

// The fallback prevents the public delivery page from failing when staff variables are absent.
export const supabase = createClient(
  supabaseUrl ?? 'https://not-configured.supabase.co',
  supabasePublishableKey ?? 'not-configured',
)

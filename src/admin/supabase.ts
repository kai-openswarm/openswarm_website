import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabaseConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null

/** The browser client, or null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null
  client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Magic links land on /admin/ with the session in the URL.
      detectSessionInUrl: true,
      storageKey: 'openswarm-admin-auth',
    },
  })
  return client
}

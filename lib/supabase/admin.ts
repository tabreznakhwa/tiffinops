import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// Service-role client — NEVER import in client components or expose to browser.
// Used only for auth callbacks and admin operations that bypass RLS.
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

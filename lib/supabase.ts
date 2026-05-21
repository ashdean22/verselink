import { createClient } from '@supabase/supabase-js'

// Browser client — uses the anon key, subject to Row Level Security.
// Safe to use in Client Components (NEXT_PUBLIC_ prefix means it ships to the browser).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Server-only client — uses the service role key which bypasses RLS.
// ONLY use this inside Route Handlers, Server Components, or scripts — never in Client Components.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

import { createClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Server-side client with service role (for API routes — bypasses RLS)
let serverClient: ReturnType<typeof createClient<Database>> | null = null

export function getServerClient() {
  if (!serverClient) {
    serverClient = createClient<Database>(supabaseUrl, supabaseServiceKey)
  }
  return serverClient
}

// Browser client with anon key (for client components — auth-aware via cookies)
export function getBrowserClient() {
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}

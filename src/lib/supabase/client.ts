import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// Server-side client with service role (for API routes — bypasses RLS)
let serverClient: ReturnType<typeof createClient<Database>> | null = null

export function getServerClient() {
  if (!serverClient) {
    serverClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return serverClient
}

// Browser client with anon key (for client components — auth-aware via cookies)
// Dynamic import avoids pulling @supabase/ssr into server bundles
let _browserClient: ReturnType<typeof createClient<Database>> | null = null

export function getBrowserClient() {
  if (!_browserClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createBrowserClient } = require('@supabase/ssr') as typeof import('@supabase/ssr')
    _browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return _browserClient!
}

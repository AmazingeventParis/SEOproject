import { createClient } from '@supabase/supabase-js'
import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
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

// Server component client (auth-aware via cookies — for reading session in RSC/Route Handlers)
export async function getAuthClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options)
          } catch {
            // setAll called from Server Component — ignore (middleware handles refresh)
          }
        })
      },
    },
  })
}

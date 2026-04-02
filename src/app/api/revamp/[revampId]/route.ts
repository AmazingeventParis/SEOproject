import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'

interface RouteContext {
  params: { revampId: string }
}

/**
 * GET /api/revamp/[revampId]
 * Fetch a single revamp project by ID with full data.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('*')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ revamp }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

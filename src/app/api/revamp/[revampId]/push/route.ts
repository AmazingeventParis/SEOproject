import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { pushToWordPress } from '@/lib/revamp/generator'

interface RouteContext {
  params: { revampId: string }
}

/**
 * POST /api/revamp/[revampId]/push
 * Push the generated revamp content to WordPress.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  // Verify revamp exists and content is generated
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('id, status')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (revamp.status !== 'generated') {
    return new Response(
      JSON.stringify({ error: `Impossible de pusher: statut actuel "${revamp.status}"` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Update status to pushing
  await supabase
    .from('seo_revamps')
    .update({ status: 'pushing', updated_at: new Date().toISOString() })
    .eq('id', revampId)

  const result = await pushToWordPress(revampId)

  if (result.success) {
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({ error: result.error }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

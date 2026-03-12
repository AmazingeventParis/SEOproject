import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { generateRevampContent } from '@/lib/revamp/generator'

export const maxDuration = 300 // 5 minutes for content generation

interface RouteContext {
  params: { revampId: string }
}

/**
 * POST /api/revamp/[revampId]/generate
 * Generate new content for all pending blocks in the revamp.
 * Streams SSE progress events.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  // Verify revamp exists and is approved
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('id, status, article_id')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (revamp.status !== 'approved' && revamp.status !== 'failed') {
    return new Response(
      JSON.stringify({ error: `Impossible de generer: statut actuel "${revamp.status}"` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!revamp.article_id) {
    return new Response(
      JSON.stringify({ error: 'article_id manquant. Approuvez d\'abord le revamp.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Run generation (non-streaming for simplicity, can be upgraded to SSE later)
  try {
    const result = await generateRevampContent(revampId)

    return new Response(
      JSON.stringify({
        success: true,
        written: result.written,
        errors: result.errors,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

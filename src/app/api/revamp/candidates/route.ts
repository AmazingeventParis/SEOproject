import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/client'
import { identifyCandidates } from '@/lib/revamp/identifier'

const querySchema = z.object({
  siteId: z.string().uuid(),
})

/**
 * GET /api/revamp/candidates?siteId=xxx
 * List WordPress posts ranked by revamp urgency score.
 */
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId')

  const parsed = querySchema.safeParse({ siteId })
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'siteId invalide' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = getServerClient()
  const { data: site } = await supabase
    .from('seo_sites')
    .select('id, gsc_property')
    .eq('id', parsed.data.siteId)
    .single()

  if (!site) {
    return new Response(
      JSON.stringify({ error: 'Site non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!site.gsc_property) {
    return new Response(
      JSON.stringify({ error: 'GSC non configure pour ce site' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const candidates = await identifyCandidates(parsed.data.siteId, site.gsc_property)
    const withGsc = candidates.filter(c => c.gscMetrics !== null).length
    return new Response(
      JSON.stringify({ candidates, debug: { total: candidates.length, withGsc, gscProperty: site.gsc_property } }),
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

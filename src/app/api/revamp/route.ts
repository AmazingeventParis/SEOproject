import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'

/**
 * GET /api/revamp?siteId=xxx
 * List all revamp projects for a site.
 */
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get('siteId')

  if (!siteId) {
    return new Response(
      JSON.stringify({ error: 'siteId requis' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = getServerClient()

  const { data: revamps, error } = await supabase
    .from('seo_revamps')
    .select('id, site_id, wp_post_id, wp_url, original_title, original_keyword, page_builder, status, gsc_data, audit, error, created_at, updated_at')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ revamps: revamps || [] }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

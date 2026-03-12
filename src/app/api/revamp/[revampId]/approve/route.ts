import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'

interface RouteContext {
  params: { revampId: string }
}

/**
 * POST /api/revamp/[revampId]/approve
 * Approve the audit plan. Optionally update the audit before approving.
 * Body (optional): { audit: RevampAudit }
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  // Verify revamp exists and is in the right status
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('id, status, site_id, original_keyword, original_title, article_id, audit, new_blocks, wp_post_id')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (revamp.status !== 'analyzed') {
    return new Response(
      JSON.stringify({ error: `Impossible d'approuver: statut actuel "${revamp.status}"` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Parse optional body for audit updates
  let updatedAudit = revamp.audit
  try {
    const body = await request.json()
    if (body?.audit) updatedAudit = body.audit
  } catch {
    // No body — use existing audit
  }

  // If no article_id exists, create one for the pipeline
  let articleId = revamp.article_id
  if (!articleId) {
    const { data: newArticle, error: articleError } = await supabase
      .from('seo_articles')
      .insert({
        site_id: revamp.site_id,
        keyword: revamp.original_keyword,
        status: 'writing',
        title: revamp.original_title,
        wp_post_id: revamp.wp_post_id,
        content_blocks: revamp.new_blocks || [],
      })
      .select('id')
      .single()

    if (articleError || !newArticle) {
      return new Response(
        JSON.stringify({ error: `Erreur creation article: ${articleError?.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    articleId = newArticle.id
  }

  // Update revamp status to approved
  await supabase
    .from('seo_revamps')
    .update({
      status: 'approved',
      audit: updatedAudit,
      article_id: articleId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', revampId)

  return new Response(
    JSON.stringify({ success: true, articleId }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

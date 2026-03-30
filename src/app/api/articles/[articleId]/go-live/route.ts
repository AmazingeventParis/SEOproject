import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { updatePost } from '@/lib/wordpress/client'
import { requestIndexing } from '@/lib/seo/indexing-api'

/**
 * POST /api/articles/[articleId]/go-live
 * Switches WordPress post from draft → publish, then requests Google indexing.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const { articleId } = await params
  const supabase = getServerClient()

  // 1. Fetch article
  const { data: article, error } = await supabase
    .from('seo_articles')
    .select('id, title, wp_post_id, wp_url, site_id, status, serp_data')
    .eq('id', articleId)
    .single()

  if (error || !article) {
    return NextResponse.json({ error: 'Article non trouve' }, { status: 404 })
  }

  if (!article.wp_post_id || !article.site_id) {
    return NextResponse.json(
      { error: 'Article pas encore publie sur WordPress (pas de wp_post_id)' },
      { status: 422 }
    )
  }

  // 2. Update WordPress post status to 'publish'
  try {
    await updatePost(article.site_id, article.wp_post_id, { status: 'publish' })
  } catch (err) {
    return NextResponse.json(
      { error: `Echec mise en ligne WP: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    )
  }

  // 3. Request Google indexing
  let indexingResult: { success: boolean; error?: string } = { success: false, error: 'Pas de wp_url' }
  if (article.wp_url) {
    try {
      indexingResult = await requestIndexing(article.wp_url, 'URL_UPDATED')
    } catch (err) {
      indexingResult = { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    // Store indexing request in history
    const serpData = (article.serp_data || {}) as Record<string, unknown>
    const history = (serpData.indexing_requests || []) as Record<string, unknown>[]
    history.push({
      requestedAt: new Date().toISOString(),
      url: article.wp_url,
      success: indexingResult.success,
      error: indexingResult.error || null,
      trigger: 'go-live',
    })
    if (history.length > 10) history.splice(0, history.length - 10)

    await supabase
      .from('seo_articles')
      .update({ serp_data: { ...serpData, indexing_requests: history } })
      .eq('id', articleId)
  }

  return NextResponse.json({
    success: true,
    wpStatus: 'publish',
    indexing: indexingResult.success,
    indexingError: indexingResult.error || null,
  })
}

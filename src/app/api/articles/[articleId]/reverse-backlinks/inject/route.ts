import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { injectBacklink, type BacklinkSuggestion } from '@/lib/seo/reverse-backlinks'

interface RouteContext {
  params: { articleId: string }
}

// POST /api/articles/[articleId]/reverse-backlinks/inject
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { articleId } = params

  const body = await request.json()
  const suggestionIndex = body.suggestion_index

  if (typeof suggestionIndex !== 'number') {
    return NextResponse.json({ error: 'suggestion_index requis' }, { status: 400 })
  }

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from('seo_articles')
    .select('id, site_id, serp_data')
    .eq('id', articleId)
    .single()

  if (fetchError || !article) {
    return NextResponse.json({ error: 'Article non trouve' }, { status: 404 })
  }

  const serpData = (article.serp_data || {}) as Record<string, unknown>
  const suggestions = (serpData.reverse_backlinks || []) as BacklinkSuggestion[]

  if (suggestionIndex < 0 || suggestionIndex >= suggestions.length) {
    return NextResponse.json({ error: 'Index de suggestion invalide' }, { status: 400 })
  }

  const suggestion = suggestions[suggestionIndex]

  if (suggestion.status !== 'approved') {
    return NextResponse.json(
      { error: 'La suggestion doit etre approuvee avant injection' },
      { status: 422 }
    )
  }

  try {
    await injectBacklink(
      article.site_id,
      suggestion.wp_post_id,
      suggestion.paragraph_index,
      suggestion.original_paragraph,
      suggestion.modified_paragraph
    )

    // Update status
    suggestions[suggestionIndex] = {
      ...suggestion,
      status: 'injected',
      injected_at: new Date().toISOString(),
    }

    await supabase
      .from('seo_articles')
      .update({
        serp_data: { ...serpData, reverse_backlinks: suggestions },
      })
      .eq('id', articleId)

    return NextResponse.json({ success: true, suggestion: suggestions[suggestionIndex] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

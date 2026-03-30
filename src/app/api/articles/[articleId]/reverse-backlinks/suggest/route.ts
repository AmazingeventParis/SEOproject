import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import {
  findBacklinkCandidates,
  generateBacklinkSuggestion,
  type BacklinkSuggestion,
} from '@/lib/seo/reverse-backlinks'

export const maxDuration = 120

interface RouteContext {
  params: { articleId: string }
}

// POST /api/articles/[articleId]/reverse-backlinks/suggest
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { articleId } = params

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from('seo_articles')
    .select('id, keyword, title, wp_post_id, wp_url, status, site_id, serp_data')
    .eq('id', articleId)
    .single()

  if (fetchError || !article) {
    return NextResponse.json({ error: 'Article non trouve' }, { status: 404 })
  }

  if (article.status !== 'published' && article.status !== 'refresh_needed') {
    return NextResponse.json(
      { error: "L'article doit etre publie pour suggerer des backlinks" },
      { status: 422 }
    )
  }

  if (!article.wp_post_id || !article.wp_url) {
    return NextResponse.json(
      { error: "L'article n'a pas d'ID ou d'URL WordPress" },
      { status: 422 }
    )
  }

  try {
    // Find top 3 candidates
    const candidates = await findBacklinkCandidates(
      article.site_id,
      article.keyword,
      article.title || article.keyword,
      article.wp_post_id!,
      article.wp_url!
    )

    if (candidates.length === 0) {
      return NextResponse.json({ suggestions: [], message: 'Aucun article candidat trouve' })
    }

    // Generate suggestions for each candidate
    const suggestions: BacklinkSuggestion[] = []
    for (const candidate of candidates) {
      const suggestion = await generateBacklinkSuggestion(
        { keyword: article.keyword, title: article.title || article.keyword, wpUrl: article.wp_url! },
        candidate,
        article.site_id
      )
      if (suggestion) {
        suggestions.push(suggestion)
      }
    }

    // Save in serp_data.reverse_backlinks
    const existingSerpData = (article.serp_data || {}) as Record<string, unknown>
    await supabase
      .from('seo_articles')
      .update({
        serp_data: {
          ...existingSerpData,
          reverse_backlinks: suggestions,
        },
      })
      .eq('id', articleId)

    return NextResponse.json({ suggestions })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

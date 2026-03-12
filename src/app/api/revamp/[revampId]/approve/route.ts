import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import type { SearchIntent } from '@/lib/supabase/types'
import type { RevampLinkSuggestions } from '@/lib/revamp/types'

interface RouteContext {
  params: { revampId: string }
}

/**
 * POST /api/revamp/[revampId]/approve
 * Approve the audit plan. Optionally update the audit before approving.
 * Creates a full seo_articles row with search_intent, persona, etc.
 * Body (optional): { audit: RevampAudit, personaId?: string }
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
    .select('id, status, site_id, original_keyword, original_title, article_id, audit, new_blocks, wp_post_id, gsc_data, preserved_links, link_suggestions')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Allow re-approve from analyzed, approved, generated, completed, or failed
  const allowedForApprove = ['analyzed', 'approved', 'generated', 'completed', 'failed']
  if (!allowedForApprove.includes(revamp.status)) {
    return new Response(
      JSON.stringify({ error: `Impossible d'approuver: statut actuel "${revamp.status}"` }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Parse optional body for audit updates and persona selection
  let updatedAudit = revamp.audit
  let personaId: string | null = null
  try {
    const body = await request.json()
    if (body?.audit) updatedAudit = body.audit
    if (body?.personaId) personaId = body.personaId
  } catch {
    // No body — use existing audit
  }

  // Auto-detect search intent from GSC top query
  const gscData = revamp.gsc_data as Record<string, unknown> | null
  const topQueries = (gscData?.topQueries as { query: string }[]) || []
  const bestQuery = topQueries[0]?.query || revamp.original_keyword
  const searchIntent = detectSearchIntent(bestQuery) as SearchIntent

  // If no persona provided, get the site's default (first persona)
  if (!personaId) {
    const { data: personas } = await supabase
      .from('seo_personas')
      .select('id')
      .eq('site_id', revamp.site_id)
      .limit(1)
    if (personas && personas.length > 0) {
      personaId = personas[0].id
    }
  }

  // Build internal link targets from preserved links + user-selected suggestions
  const preservedLinks = (revamp.preserved_links || []) as { url: string; anchor: string; isInternal: boolean }[]
  const internalLinks = preservedLinks.filter(l => l.isInternal)

  // Merge selected internal links from link_suggestions
  const linkSuggestions = revamp.link_suggestions as RevampLinkSuggestions | null
  if (linkSuggestions?.internal) {
    const selectedInternal = linkSuggestions.internal.filter(l => l.selected)
    const existingUrls = new Set(internalLinks.map(l => l.url))
    for (const link of selectedInternal) {
      if (!existingUrls.has(link.wp_url)) {
        internalLinks.push({ url: link.wp_url, anchor: link.anchor_text, isInternal: true })
        existingUrls.add(link.wp_url)
      }
    }
  }

  // Enrich blocks with internal_link_targets for the writer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newBlocks = (revamp.new_blocks || []) as any[]
  const enrichedBlocks = newBlocks.map((block, idx) => {
    // Distribute internal links across pending blocks
    if (block.status === 'pending' && internalLinks.length > 0) {
      const linksPerBlock = Math.ceil(internalLinks.length / newBlocks.filter(b => b.status === 'pending').length)
      const pendingIdx = newBlocks.slice(0, idx).filter(b => b.status === 'pending').length
      const startLink = pendingIdx * linksPerBlock
      const blockLinks = internalLinks.slice(startLink, startLink + linksPerBlock)
      if (blockLinks.length > 0) {
        return {
          ...block,
          internal_link_targets: blockLinks.map(l => {
            // Extract slug from URL for compatibility with block-writer format
            let slug = ''
            try { slug = new URL(l.url).pathname.replace(/^\/|\/$/g, '') } catch { slug = l.url }
            return {
              target_slug: slug,
              target_title: l.anchor,
              suggested_anchor_context: l.anchor,
              url: l.url, // Also keep full URL for direct use
            }
          }),
        }
      }
    }
    return block
  })

  // Build selected authority link for the article (used by block-writer)
  const selectedAuthorityLink = linkSuggestions?.selectedAuthority || null

  // If no article_id exists, create a full article for the pipeline
  let articleId = revamp.article_id
  if (!articleId) {
    const { data: newArticle, error: articleError } = await supabase
      .from('seo_articles')
      .insert({
        site_id: revamp.site_id,
        keyword: revamp.original_keyword,
        search_intent: searchIntent,
        status: 'writing',
        title: revamp.original_title,
        wp_post_id: revamp.wp_post_id,
        content_blocks: enrichedBlocks,
        persona_id: personaId,
        year_tag: new Date().getFullYear(),
        selected_authority_link: selectedAuthorityLink,
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
  } else {
    // Update existing article with enriched data
    await supabase
      .from('seo_articles')
      .update({
        search_intent: searchIntent,
        content_blocks: enrichedBlocks,
        persona_id: personaId,
        year_tag: new Date().getFullYear(),
        selected_authority_link: selectedAuthorityLink,
      })
      .eq('id', articleId)
  }

  // Update revamp status to approved with enriched blocks
  await supabase
    .from('seo_revamps')
    .update({
      status: 'approved',
      audit: updatedAudit,
      article_id: articleId,
      new_blocks: enrichedBlocks,
      updated_at: new Date().toISOString(),
    })
    .eq('id', revampId)

  return new Response(
    JSON.stringify({ success: true, articleId, searchIntent }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Detect search intent from a query string (same logic as identifier.ts).
 */
function detectSearchIntent(query: string): string {
  const q = query.toLowerCase()
  if (/\bvs\b|\bversus\b|\bcompar|\bou\b.*\bou\b|\bmieux\b|\bmeilleur/.test(q)) return 'comparison'
  if (/\bavis\b|\btest\b|\breview\b|\bexperience\b|\bfiable\b/.test(q)) return 'review'
  if (/\bcomment\b|\bpourquoi\b|\bqu'est-ce\b|\bc'est quoi\b|\bdefinition\b|\bguide\b|\btuto/.test(q)) return 'informational'
  if (/\bacheter\b|\bprix\b|\btarif\b|\bdevis\b|\bpromo\b|\bpas cher\b|\bcommand/.test(q)) return 'lead_gen'
  if (/\b202[4-9]\b|\bnouveau\b|\btendance\b|\bactualit/.test(q)) return 'discover'
  return 'traffic'
}

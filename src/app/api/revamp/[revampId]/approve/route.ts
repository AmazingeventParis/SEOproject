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

  // Fetch nuggets for this site, scored by keyword relevance + recency
  const { data: siteNuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags, created_at')
    .or(`site_ids.cs.{${revamp.site_id}},site_id.eq.${revamp.site_id},site_id.is.null`)
    .limit(50)

  const currentYear = new Date().getFullYear()
  const kwWordsForNuggets = revamp.original_keyword.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
  const scoredNuggets = (siteNuggets || []).map(n => {
    let score = 0
    const tagStr = (n.tags || []).join(' ').toLowerCase()
    const contentStr = n.content.toLowerCase()
    for (const w of kwWordsForNuggets) {
      if (tagStr.includes(w)) score += 5
      if (contentStr.includes(w)) score += 2
    }
    // Recency boost: recent nuggets have up-to-date data (stats, facts, quotes)
    const nYear = n.created_at ? new Date(n.created_at).getFullYear() : 0
    if (nYear === currentYear) score += 5
    else if (nYear === currentYear - 1) score += 2
    return { id: n.id, content: n.content, tags: n.tags, score }
  })
    .filter(n => n.score >= 4)
    .sort((a, b) => b.score - a.score)

  // Enrich blocks with internal_link_targets for the writer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newBlocks = (revamp.new_blocks || []) as any[]

  // Assign nuggets to pending blocks (rewrite + new sections)
  // Each nugget assigned to at most 1 block, max 2 nuggets per block
  const usedNuggetIds = new Set<string>()
  const pendingBlockIndices = newBlocks
    .map((b, i) => b.status === 'pending' ? i : -1)
    .filter(i => i >= 0)

  for (const idx of pendingBlockIndices) {
    const block = newBlocks[idx]
    const headingWords = (block.heading || '').toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3)
    // Score nuggets for this specific block heading + general keyword
    const blockScored = scoredNuggets
      .filter(n => !usedNuggetIds.has(n.id))
      .map(n => {
        let blockScore = n.score
        const tagStr = (n.tags || []).join(' ').toLowerCase()
        const contentStr = n.content.toLowerCase()
        for (const w of headingWords) {
          if (tagStr.includes(w)) blockScore += 3
          if (contentStr.includes(w)) blockScore += 1
        }
        return { ...n, blockScore }
      })
      .filter(n => n.blockScore >= 6)
      .sort((a, b) => b.blockScore - a.blockScore)
      .slice(0, 2) // max 2 nuggets per block

    if (blockScored.length > 0) {
      newBlocks[idx] = {
        ...block,
        nugget_ids: blockScored.map(n => n.id),
      }
      for (const n of blockScored) usedNuggetIds.add(n.id)
    }
  }

  if (usedNuggetIds.size > 0) {
    console.log(`[revamp-approve] Assigned ${usedNuggetIds.size} nuggets across ${pendingBlockIndices.length} pending blocks`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrichedBlocks = newBlocks.map((block: any, idx: number) => {
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

  // Extract meta data from audit
  const auditData = updatedAudit as Record<string, unknown> | null
  const suggestedTitle = (auditData?.suggestedTitle as string) || revamp.original_title
  const suggestedMetaDesc = (auditData?.suggestedMetaDescription as string) || null

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
        title: suggestedTitle,
        seo_title: suggestedTitle,
        meta_description: suggestedMetaDesc,
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
        title: suggestedTitle,
        seo_title: suggestedTitle,
        meta_description: suggestedMetaDesc,
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

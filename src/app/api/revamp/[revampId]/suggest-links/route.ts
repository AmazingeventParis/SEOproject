import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import { analyzeSERP } from '@/lib/seo/serper'
import { routeAI } from '@/lib/ai/router'
import type {
  RevampAuthorityLinkSuggestion,
  RevampInternalLinkSuggestion,
  RevampLinkSuggestions,
} from '@/lib/revamp/types'

interface RouteContext {
  params: { revampId: string }
}

const AUTHORITY_PATTERNS = [
  'wikipedia.org', 'gouv.fr', 'service-public.fr',
  '.edu', 'who.int', 'europa.eu', 'legifrance.gouv.fr',
  'insee.fr', 'has-sante.fr', 'ademe.fr',
  'nature.com', 'sciencedirect.com', 'springer.com',
  'lemonde.fr', 'lefigaro.fr',
]

function isAuthority(url: string): boolean {
  return AUTHORITY_PATTERNS.some(p => url.includes(p))
}

/**
 * POST /api/revamp/[revampId]/suggest-links
 * Generate authority link + internal link suggestions for a revamp project.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  // Fetch revamp
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('id, site_id, original_keyword, gsc_data, serp_comparison, wp_url, wp_post_id')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // --- Authority link suggestions ---
    const authoritySuggestions = await generateAuthoritySuggestions(
      revamp.original_keyword,
      revamp.serp_comparison
    )

    // --- Internal link suggestions ---
    const internalSuggestions = await generateInternalSuggestions(
      revamp.site_id,
      revamp.original_keyword,
      revamp.wp_post_id
    )

    const linkSuggestions: RevampLinkSuggestions = {
      authority: authoritySuggestions,
      internal: internalSuggestions,
      selectedAuthority: null,
    }

    // Save to DB
    await supabase
      .from('seo_revamps')
      .update({
        link_suggestions: linkSuggestions as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revampId)

    return new Response(
      JSON.stringify({ success: true, linkSuggestions }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: `Erreur generation liens: ${msg}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function generateAuthoritySuggestions(
  keyword: string,
  serpComparison: Record<string, unknown> | null,
): Promise<RevampAuthorityLinkSuggestion[]> {
  // 1. Extract authority links from SERP competitors
  const competitors = (serpComparison as { competitors?: { url: string; title: string }[] } | null)?.competitors || []
  let candidates: { url: string; title: string; domain: string; snippet: string }[] = []

  // Filter competitors for authority domains
  for (const comp of competitors) {
    if (comp.url && isAuthority(comp.url)) {
      try {
        candidates.push({
          url: comp.url,
          title: comp.title || '',
          domain: new URL(comp.url).hostname,
          snippet: '',
        })
      } catch { /* invalid URL */ }
    }
  }

  // 2. Supplementary Serper query if < 2
  if (candidates.length < 2) {
    try {
      const suppSerp = await analyzeSERP(
        `"${keyword}" etude OR statistiques OR officiel`,
        { num: 10 }
      )
      const suppResults = (suppSerp?.organic || []) as {
        title: string; link: string; snippet?: string; domain?: string
      }[]
      const existingUrls = new Set(candidates.map(c => c.url))
      const newCandidates = suppResults
        .filter(r => r.link && isAuthority(r.link) && !existingUrls.has(r.link))
        .map(r => ({
          url: r.link,
          title: r.title || '',
          domain: r.domain || new URL(r.link).hostname,
          snippet: r.snippet || '',
        }))
      candidates = [...candidates, ...newCandidates]
    } catch {
      // Supplementary SERP failed
    }
  }

  if (candidates.length === 0) return []

  // 3. HEAD-check
  const validationResults = await Promise.allSettled(
    candidates.slice(0, 5).map(async c => {
      try {
        const res = await fetch(c.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        })
        return { ...c, is_valid: res.status >= 200 && res.status < 400 }
      } catch {
        return { ...c, is_valid: false }
      }
    })
  )
  const checkedCandidates = validationResults
    .filter((r): r is PromiseFulfilledResult<typeof candidates[0] & { is_valid: boolean }> =>
      r.status === 'fulfilled'
    )
    .map(r => r.value)

  if (checkedCandidates.length === 0) return []

  // 4. Gemini Flash evaluation
  const evalPrompt = `Tu es un expert SEO. Voici des sources potentielles d'autorite pour un article sur "${keyword}".

Candidats :
${checkedCandidates.map((c, i) => `${i + 1}. ${c.title} (${c.domain}) — ${c.snippet.slice(0, 150)}`).join('\n')}

Selectionne les 2-3 meilleures sources pour renforcer l'E-E-A-T de l'article.
Pour chaque source selectionnee, fournis :
- rationale : pourquoi cette source renforce la credibilite (1 phrase)
- anchor_context : suggestion de phrase dans laquelle integrer le lien (1 phrase)

Retourne UNIQUEMENT un JSON valide :
{
  "selections": [
    { "index": 0, "rationale": "...", "anchor_context": "..." }
  ]
}
Pas de texte avant ou apres le JSON.`

  try {
    const evalResponse = await routeAI('evaluate_authority_links', [
      { role: 'user', content: evalPrompt },
    ])
    const evalCleaned = evalResponse.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()
    const evalParsed = JSON.parse(evalCleaned) as {
      selections: { index: number; rationale: string; anchor_context: string }[]
    }

    return (evalParsed.selections || [])
      .filter(s => checkedCandidates[s.index])
      .map(s => ({
        url: checkedCandidates[s.index].url,
        title: checkedCandidates[s.index].title,
        domain: checkedCandidates[s.index].domain,
        snippet: checkedCandidates[s.index].snippet,
        rationale: s.rationale,
        is_valid: checkedCandidates[s.index].is_valid,
        selected: false,
      }))
  } catch {
    // If eval fails, return raw candidates without rationale
    return checkedCandidates.filter(c => c.is_valid).slice(0, 3).map(c => ({
      url: c.url,
      title: c.title,
      domain: c.domain,
      snippet: c.snippet,
      rationale: 'Source fiable identifiee par analyse SERP',
      is_valid: c.is_valid,
      selected: false,
    }))
  }
}

async function generateInternalSuggestions(
  siteId: string,
  keyword: string,
  wpPostId: number,
): Promise<RevampInternalLinkSuggestion[]> {
  const supabase = getServerClient()

  // Fetch site domain for URL building
  const { data: site } = await supabase
    .from('seo_sites')
    .select('domain')
    .eq('id', siteId)
    .single()
  const domain = site?.domain || ''

  // 1. Get all published articles from the same site
  const { data: siteArticles } = await supabase
    .from('seo_articles')
    .select('id, title, keyword, slug, wp_url, wp_post_id')
    .eq('site_id', siteId)
    .in('status', ['published', 'reviewing', 'writing'])
    .not('slug', 'is', null)
    .limit(50)

  // 2. Also get WP published posts for broader coverage
  let wpPosts: { id: number; title: string; slug: string; link: string }[] = []
  try {
    const { getAllPublishedPosts } = await import('@/lib/wordpress/client')
    wpPosts = await getAllPublishedPosts(siteId)
  } catch {
    // WP fetch failed
  }

  const suggestions: RevampInternalLinkSuggestion[] = []
  const seenUrls = new Set<string>()
  const keywordWords = keyword.toLowerCase().split(/\s+/)

  // Score relevance by keyword overlap
  function relevanceScore(title: string, targetKeyword: string): number {
    const titleWords = title.toLowerCase().split(/\s+/)
    const targetWords = targetKeyword.toLowerCase().split(/\s+/)
    const allWords = [...titleWords, ...targetWords]
    let overlap = 0
    for (const w of keywordWords) {
      if (w.length > 2 && allWords.some(tw => tw.includes(w) || w.includes(tw))) {
        overlap++
      }
    }
    return overlap
  }

  // Process DB articles
  for (const article of siteArticles || []) {
    if (article.wp_post_id === wpPostId) continue // Skip self
    const url = article.wp_url || (domain ? `https://${domain}/${article.slug}` : `/${article.slug}`)
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    const score = relevanceScore(article.title || '', article.keyword)
    if (score > 0 || suggestions.length < 5) {
      suggestions.push({
        article_id: article.id,
        wp_url: url,
        title: article.title || article.keyword,
        keyword: article.keyword,
        anchor_text: article.title || article.keyword,
        selected: false,
      })
    }
  }

  // Process WP posts (not already in DB)
  for (const post of wpPosts) {
    if (post.id === wpPostId) continue // Skip self
    if (seenUrls.has(post.link)) continue
    seenUrls.add(post.link)

    const score = relevanceScore(post.title, '')
    if (score > 0 || suggestions.length < 8) {
      suggestions.push({
        article_id: null,
        wp_url: post.link,
        title: post.title,
        keyword: post.title,
        anchor_text: post.title,
        selected: false,
      })
    }
  }

  // Sort by relevance and cap at 10
  suggestions.sort((a, b) => {
    const scoreA = relevanceScore(a.title, a.keyword)
    const scoreB = relevanceScore(b.title, b.keyword)
    return scoreB - scoreA
  })

  return suggestions.slice(0, 10)
}

// ============================================================
// Revamp Identifier — Find articles that need revamping
// Uses GSC data + WordPress post metadata to score candidates
// ============================================================

import { getQueriesForPage, getTopPages, type GSCRow } from '@/lib/seo/gsc'
import { getAllPublishedPosts, getPostById } from '@/lib/wordpress/client'
import { getServerClient } from '@/lib/supabase/client'
import { detectPageBuilder, extractLinks, extractCTAs } from './wp-cleaner'
import { parseHtmlToBlocks } from '@/lib/pipeline/html-parser'
import type { RevampCandidate, RevampGSCData, PageBuilder } from './types'
import type { ContentBlock } from '@/lib/supabase/types'

/**
 * Normalize a URL for comparison: strip trailing slash, force https, lowercase.
 */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^http:/, 'https:')
    .replace(/\/+$/, '')
    .replace(/\?.*$/, '')
}

/**
 * Get all published WP posts for a site and score them for revamp potential.
 * Combines WordPress data with GSC performance metrics.
 * Now fetches per-page top queries for richer candidate data.
 */
export async function identifyCandidates(
  siteId: string,
  gscProperty: string,
  options: { days?: number; minImpressions?: number } = {}
): Promise<RevampCandidate[]> {
  const { days = 90 } = options

  // Fetch WP posts and GSC top pages in parallel
  const [wpPosts, gscPages] = await Promise.all([
    getAllPublishedPosts(siteId),
    getTopPages(gscProperty, 500, days).catch(() => [] as GSCRow[]),
  ])

  // Build a lookup from NORMALIZED page URL to GSC metrics
  const gscByUrl = new Map<string, GSCRow>()
  for (const row of gscPages) {
    const pageUrl = row.keys[0]
    if (pageUrl) {
      gscByUrl.set(normalizeUrl(pageUrl), row)
    }
  }

  // Also fetch per-page query data for the top pages (batch)
  // We'll fetch queries for each WP post that has GSC data
  const pageQueryMap = new Map<string, GSCRow[]>()

  // Batch fetch queries for pages with GSC data (limit to top 50 to avoid API limits)
  const postsWithGsc: { link: string; normalizedLink: string }[] = []
  for (const post of wpPosts) {
    const normalized = normalizeUrl(post.link)
    if (gscByUrl.has(normalized)) {
      postsWithGsc.push({ link: post.link, normalizedLink: normalized })
    }
  }

  // Fetch queries for up to 30 pages in parallel (batches of 5)
  const pagesToQuery = postsWithGsc.slice(0, 30)
  for (let i = 0; i < pagesToQuery.length; i += 5) {
    const batch = pagesToQuery.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(p =>
        getQueriesForPage(gscProperty, p.link, days)
          .then(rows => ({ link: p.normalizedLink, rows }))
          .catch(() => ({ link: p.normalizedLink, rows: [] as GSCRow[] }))
      )
    )
    for (const r of results) {
      if (r.rows.length > 0) pageQueryMap.set(r.link, r.rows)
    }
  }

  // Already revamped or in-progress articles (exclude from candidates)
  const supabase = getServerClient()
  const { data: existingRevamps } = await supabase
    .from('seo_revamps')
    .select('wp_post_id, status')
    .eq('site_id', siteId)

  const activeRevampPostIds = new Set(
    (existingRevamps || [])
      .filter(r => r.status !== 'completed' && r.status !== 'failed')
      .map(r => r.wp_post_id)
  )

  const candidates: RevampCandidate[] = []

  for (const post of wpPosts) {
    if (activeRevampPostIds.has(post.id)) continue

    const normalized = normalizeUrl(post.link)

    // Find GSC data for this post (normalized URL matching)
    const gsc = gscByUrl.get(normalized)
    const metrics = gsc
      ? { clicks: gsc.clicks, impressions: gsc.impressions, ctr: gsc.ctr, position: gsc.position }
      : null

    // Get per-page queries
    const queries = pageQueryMap.get(normalized) || []

    // Build top keywords (by impressions)
    const topKeywords = queries
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .map(q => ({
        query: q.keys[0],
        clicks: q.clicks,
        impressions: q.impressions,
        ctr: q.ctr,
        position: q.position,
      }))

    // Identify best keyword (highest impressions)
    const bestKeyword = topKeywords.length > 0 ? topKeywords[0] : null

    // Detect search intent from best keyword
    const searchIntent = bestKeyword ? detectSearchIntent(bestKeyword.query) : null

    // Identify strengths and weaknesses from GSC data
    const strengths: string[] = []
    const weaknesses: string[] = []

    if (metrics) {
      // Strengths
      if (metrics.position < 5) strengths.push(`Top 5 Google (pos ${metrics.position.toFixed(1)})`)
      else if (metrics.position < 10) strengths.push(`Page 1 Google (pos ${metrics.position.toFixed(1)})`)
      if (metrics.ctr > 0.05) strengths.push(`Bon CTR (${(metrics.ctr * 100).toFixed(1)}%)`)
      if (metrics.clicks > 50) strengths.push(`${metrics.clicks} clics/90j`)
      if (metrics.impressions > 500) strengths.push(`Forte visibilite (${metrics.impressions} imp.)`)
      if (topKeywords.length >= 3) strengths.push(`${topKeywords.length} mots-cles positionnes`)

      // Weaknesses
      if (metrics.position >= 10 && metrics.position <= 20) weaknesses.push(`Page 2 Google (pos ${metrics.position.toFixed(1)}) — potentiel page 1`)
      else if (metrics.position > 20) weaknesses.push(`Position faible (${metrics.position.toFixed(1)})`)
      if (metrics.ctr < 0.02 && metrics.impressions > 50) weaknesses.push(`CTR tres faible (${(metrics.ctr * 100).toFixed(1)}%) — titre/meta a revoir`)
      else if (metrics.ctr < 0.04 && metrics.impressions > 100) weaknesses.push(`CTR ameliorable (${(metrics.ctr * 100).toFixed(1)}%)`)
      if (metrics.impressions > 200 && metrics.clicks < 5) weaknesses.push(`${metrics.impressions} impressions mais seulement ${metrics.clicks} clics`)

      // Opportunity keywords (positioned 5-20 = almost page 1)
      const opportunities = queries.filter(q => q.position >= 5 && q.position <= 20 && q.impressions >= 10)
      if (opportunities.length > 0) {
        weaknesses.push(`${opportunities.length} mot(s)-cle(s) en page 2 a pousser`)
      }
    } else {
      weaknesses.push('Aucune donnee GSC — article peut-etre non indexe ou tres recent')
    }

    // Calculate revamp score
    const score = calculateRevampScore(metrics, queries.length)

    candidates.push({
      wpPostId: post.id,
      wpUrl: post.link,
      title: post.title,
      slug: post.slug,
      publishedDate: null,
      gscMetrics: metrics,
      daysSincePublished: null,
      revampScore: score,
      pageBuilder: 'unknown' as PageBuilder,
      topKeywords,
      bestKeyword: bestKeyword ? bestKeyword.query : null,
      searchIntent,
      strengths,
      weaknesses,
    })
  }

  // Sort by revamp score descending
  return candidates.sort((a, b) => b.revampScore - a.revampScore)
}

/**
 * Detect search intent from a query string.
 */
function detectSearchIntent(query: string): string {
  const q = query.toLowerCase()

  // Comparison
  if (/\bvs\b|\bversus\b|\bcompar|\bou\b.*\bou\b|\bmieux\b|\bmeilleur/.test(q)) return 'comparison'

  // Review / avis
  if (/\bavis\b|\btest\b|\breview\b|\bexperience\b|\bfiable\b/.test(q)) return 'review'

  // How-to / informational
  if (/\bcomment\b|\bpourquoi\b|\bqu'est-ce\b|\bc'est quoi\b|\bdefinition\b|\bguide\b|\btuto/.test(q)) return 'informational'

  // Transactional / lead
  if (/\bacheter\b|\bprix\b|\btarif\b|\bdevis\b|\bpromo\b|\bpas cher\b|\bcommand/.test(q)) return 'lead_gen'

  // Discover / trending
  if (/\b202[4-9]\b|\bnouveau\b|\btendance\b|\bactualit/.test(q)) return 'discover'

  // Default: traffic / informational
  return 'traffic'
}

/**
 * Calculate a revamp urgency score (0-100).
 */
function calculateRevampScore(
  metrics: { clicks: number; impressions: number; ctr: number; position: number } | null,
  queryCount: number
): number {
  if (!metrics) return 20 // Low default — no GSC data

  let score = 0

  // Position factor (positions 5-20 = highest potential for improvement)
  if (metrics.position >= 5 && metrics.position <= 10) score += 35
  else if (metrics.position > 10 && metrics.position <= 20) score += 30
  else if (metrics.position > 20 && metrics.position <= 40) score += 15
  else if (metrics.position > 40) score += 10
  else score += 5 // Already in top 5, less urgent

  // CTR factor (low CTR = title/meta needs work)
  if (metrics.ctr < 0.01) score += 25
  else if (metrics.ctr < 0.03) score += 20
  else if (metrics.ctr < 0.05) score += 10

  // Impression factor (more impressions = more opportunity)
  if (metrics.impressions >= 1000) score += 25
  else if (metrics.impressions >= 500) score += 20
  else if (metrics.impressions >= 100) score += 15
  else if (metrics.impressions >= 20) score += 10
  else score += 5

  // Many keywords = article covers a topic well, worth optimizing
  if (queryCount >= 20) score += 5
  else if (queryCount >= 10) score += 3

  // Clicks efficiency: lots of impressions but few clicks
  if (metrics.impressions > 100 && metrics.clicks < 5) score += 10

  return Math.min(100, score)
}

/**
 * Analyze a single WP post for detailed revamp data.
 */
export async function analyzePost(
  siteId: string,
  wpPostId: number,
  gscProperty: string,
): Promise<{
  gscData: RevampGSCData
  pageBuilder: PageBuilder
  originalBlocks: ContentBlock[]
  preservedLinks: { url: string; anchor: string; isInternal: boolean }[]
  preservedCTAs: string[]
  wordCount: number
}> {
  // Fetch WP post content
  const post = await getPostById(siteId, wpPostId)

  // Detect page builder
  const pageBuilder = detectPageBuilder(post.content)

  // Get site domain for link classification
  const supabase = getServerClient()
  const { data: site } = await supabase
    .from('seo_sites')
    .select('domain')
    .eq('id', siteId)
    .single()

  const domain = site?.domain || ''

  // Extract links and CTAs before cleaning
  const preservedLinks = extractLinks(post.content, domain)
  const preservedCTAs = extractCTAs(post.content)

  // Parse into content blocks (using existing parser)
  const originalBlocks = parseHtmlToBlocks(post.content)

  // Calculate total word count
  const wordCount = originalBlocks.reduce((sum, b) => sum + b.word_count, 0)

  // Fetch GSC data for this specific page
  const pageQueries = await getQueriesForPage(gscProperty, post.link, 90).catch(() => [] as GSCRow[])

  // Build GSC data
  const totalClicks = pageQueries.reduce((sum, q) => sum + q.clicks, 0)
  const totalImpressions = pageQueries.reduce((sum, q) => sum + q.impressions, 0)

  const gscData: RevampGSCData = {
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgPosition: pageQueries.length > 0
      ? pageQueries.reduce((sum, q) => sum + q.position * q.impressions, 0) / Math.max(totalImpressions, 1)
      : 0,
    topQueries: pageQueries.slice(0, 20).map(q => ({
      query: q.keys[0],
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.ctr,
      position: q.position,
    })),
    opportunityKeywords: pageQueries
      .filter(q => q.position >= 5 && q.position <= 20 && q.impressions >= 5)
      .map(q => ({
        query: q.keys[0],
        impressions: q.impressions,
        position: q.position,
        opportunityScore: Math.round(q.impressions * (1 - q.ctr) * (21 - q.position)),
      }))
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 10),
  }

  return {
    gscData,
    pageBuilder,
    originalBlocks,
    preservedLinks,
    preservedCTAs,
    wordCount,
  }
}

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
 * Get all published WP posts for a site and score them for revamp potential.
 * Combines WordPress data with GSC performance metrics.
 */
export async function identifyCandidates(
  siteId: string,
  gscProperty: string,
  options: { days?: number; minImpressions?: number } = {}
): Promise<RevampCandidate[]> {
  const { days = 90, minImpressions = 5 } = options

  // Fetch WP posts and GSC top pages in parallel
  const [wpPosts, gscPages] = await Promise.all([
    getAllPublishedPosts(siteId),
    getTopPages(gscProperty, 200, days).catch(() => [] as GSCRow[]),
  ])

  // Build a lookup from page URL to GSC metrics
  const gscByUrl = new Map<string, GSCRow>()
  for (const row of gscPages) {
    const pageUrl = row.keys[0]
    if (pageUrl) gscByUrl.set(pageUrl, row)
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

    // Find GSC data for this post
    const gsc = gscByUrl.get(post.link)
    const metrics = gsc
      ? { clicks: gsc.clicks, impressions: gsc.impressions, ctr: gsc.ctr, position: gsc.position }
      : null

    // Skip if too few impressions (not enough data)
    if (metrics && metrics.impressions < minImpressions) continue

    // Calculate revamp score
    const score = calculateRevampScore(metrics)

    candidates.push({
      wpPostId: post.id,
      wpUrl: post.link,
      title: post.title,
      slug: post.slug,
      publishedDate: null, // Could be enriched later
      gscMetrics: metrics,
      daysSincePublished: null,
      revampScore: score,
      pageBuilder: 'unknown' as PageBuilder, // Detected during analysis
    })
  }

  // Sort by revamp score descending
  return candidates.sort((a, b) => b.revampScore - a.revampScore)
}

/**
 * Calculate a revamp urgency score (0-100).
 * High score = article needs revamp urgently.
 *
 * Factors:
 * - Low CTR with high impressions = missed opportunity
 * - Position 5-20 = just out of top results, can be improved
 * - Very low position (>30) with impressions = content is indexed but failing
 */
function calculateRevampScore(
  metrics: { clicks: number; impressions: number; ctr: number; position: number } | null,
): number {
  if (!metrics) return 30 // Default score for articles without GSC data

  let score = 0

  // Position factor (positions 5-20 = highest potential)
  if (metrics.position >= 5 && metrics.position <= 10) score += 35
  else if (metrics.position > 10 && metrics.position <= 20) score += 25
  else if (metrics.position > 20 && metrics.position <= 40) score += 15
  else if (metrics.position > 40) score += 10
  else score += 5 // Already in top 5, less urgent

  // CTR factor (low CTR = title/meta needs work)
  if (metrics.ctr < 0.01) score += 25
  else if (metrics.ctr < 0.03) score += 20
  else if (metrics.ctr < 0.05) score += 10
  else score += 0

  // Impression factor (more impressions = more opportunity)
  if (metrics.impressions >= 1000) score += 25
  else if (metrics.impressions >= 500) score += 20
  else if (metrics.impressions >= 100) score += 15
  else if (metrics.impressions >= 20) score += 10
  else score += 5

  // Clicks efficiency: lots of impressions but few clicks
  if (metrics.impressions > 100 && metrics.clicks < 5) score += 15

  return Math.min(100, score)
}

/**
 * Analyze a single WP post for detailed revamp data.
 * Fetches full content, extracts GSC queries, detects builder, preserves links/CTAs.
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

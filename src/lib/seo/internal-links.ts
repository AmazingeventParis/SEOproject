// ============================================================
// Internal linking engine for silo-based content strategy
// Generates, injects, and manages internal links within a silo
// ============================================================

import { getServerClient } from '@/lib/supabase/client'
import type { ArticleStatus } from '@/lib/supabase/types'

// ---- Types ----

export interface InternalLinkSuggestion {
  targetArticleId: string
  targetKeyword: string
  targetSlug: string
  anchorText: string
  suggested: boolean
}

export interface SiloLinkMap {
  articles: Array<{
    id: string
    title: string | null
    keyword: string
    slug: string | null
    status: ArticleStatus
  }>
  links: Array<{
    sourceId: string
    targetId: string
    anchorText: string
    isBidirectional: boolean
  }>
}

// ---- Constants ----

const MIN_LINK_SUGGESTIONS = 5
const MAX_LINK_SUGGESTIONS = 8

// ---- Internal link generation ----

/**
 * Generate internal link suggestions for an article within its silo.
 *
 * For each sibling article in the silo, checks whether the current article's
 * content mentions the sibling's keyword. If so, suggests an internal link
 * with the keyword as anchor text. Existing silo links are also included.
 *
 * @param articleId  The current article's UUID
 * @param siloId    The silo UUID containing the article
 * @returns         Array of link suggestions (5-8 max)
 */
export async function generateInternalLinks(
  articleId: string,
  siloId: string
): Promise<InternalLinkSuggestion[]> {
  const supabase = getServerClient()

  // Fetch the current article's content for keyword matching
  const { data: currentArticle, error: currentError } = await supabase
    .from('seo_articles')
    .select('content_html, keyword')
    .eq('id', articleId)
    .single()

  if (currentError || !currentArticle) {
    throw new Error(
      `Failed to fetch article ${articleId}: ${currentError?.message ?? 'not found'}`
    )
  }

  const currentContent = (currentArticle.content_html ?? '').toLowerCase()

  // Fetch all other articles in the same silo
  const { data: siloArticles, error: siloError } = await supabase
    .from('seo_articles')
    .select('id, title, keyword, slug')
    .eq('silo_id', siloId)
    .neq('id', articleId)

  if (siloError) {
    throw new Error(`Failed to fetch silo articles: ${siloError.message}`)
  }

  // Fetch existing silo links for context
  const { data: existingLinks, error: linksError } = await supabase
    .from('seo_silo_links')
    .select('source_article_id, target_article_id, anchor_text')
    .eq('silo_id', siloId)

  if (linksError) {
    throw new Error(`Failed to fetch silo links: ${linksError.message}`)
  }

  // Build set of already-linked target IDs from this article
  const alreadyLinkedTargets = new Set(
    (existingLinks ?? [])
      .filter((link) => link.source_article_id === articleId)
      .map((link) => link.target_article_id)
  )

  const suggestions: InternalLinkSuggestion[] = []

  // Include existing links as non-suggested entries
  for (const link of existingLinks ?? []) {
    if (link.source_article_id !== articleId) continue

    const targetArticle = (siloArticles ?? []).find((a) => a.id === link.target_article_id)
    if (!targetArticle || !targetArticle.slug) continue

    suggestions.push({
      targetArticleId: targetArticle.id,
      targetKeyword: targetArticle.keyword,
      targetSlug: targetArticle.slug,
      anchorText: link.anchor_text,
      suggested: false,
    })
  }

  // Suggest new links based on keyword mentions in content
  for (const article of siloArticles ?? []) {
    if (!article.title || !article.slug) continue
    if (alreadyLinkedTargets.has(article.id)) continue

    const keywordLower = article.keyword.toLowerCase()

    // Check if the current article's content mentions this keyword
    if (currentContent.includes(keywordLower)) {
      suggestions.push({
        targetArticleId: article.id,
        targetKeyword: article.keyword,
        targetSlug: article.slug,
        anchorText: article.keyword,
        suggested: true,
      })
    }
  }

  // Enforce 5-8 limit: prioritize existing links, then suggested ones
  if (suggestions.length > MAX_LINK_SUGGESTIONS) {
    // Keep existing links first, then fill with suggestions
    const existing = suggestions.filter((s) => !s.suggested)
    const suggested = suggestions.filter((s) => s.suggested)
    const remaining = MAX_LINK_SUGGESTIONS - existing.length
    return [...existing, ...suggested.slice(0, Math.max(0, remaining))].slice(
      0,
      MAX_LINK_SUGGESTIONS
    )
  }

  // If fewer than minimum, pad with title-based suggestions for unlinked articles
  if (suggestions.length < MIN_LINK_SUGGESTIONS) {
    const suggestedIds = new Set(suggestions.map((s) => s.targetArticleId))

    for (const article of siloArticles ?? []) {
      if (suggestions.length >= MIN_LINK_SUGGESTIONS) break
      if (!article.title || !article.slug) continue
      if (suggestedIds.has(article.id)) continue

      suggestions.push({
        targetArticleId: article.id,
        targetKeyword: article.keyword,
        targetSlug: article.slug,
        anchorText: article.title,
        suggested: true,
      })
    }
  }

  return suggestions.slice(0, MAX_LINK_SUGGESTIONS)
}

// ---- HTML link injection ----

/**
 * Regex pattern matching tags where we should NOT inject links.
 * Matches: <a ...>...</a>, <h1>-<h6> tags, and <img /> tags.
 */
const PROTECTED_TAG_PATTERN =
  /<(?:a\b[^>]*>[\s\S]*?<\/a>|h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>|img\b[^>]*\/?>)/gi

/**
 * Inject internal links into HTML content.
 *
 * For each link, finds the first occurrence of the anchor text in the HTML
 * (case-insensitive) and wraps it with an <a> tag. Occurrences inside
 * existing <a>, <h1>-<h6>, or <img> tags are protected and not modified.
 *
 * @param html   The original HTML content
 * @param links  Array of anchor text + URL pairs to inject
 * @returns      Modified HTML with links inserted
 */
export function injectLinksIntoHtml(
  html: string,
  links: { anchorText: string; url: string }[]
): string {
  let result = html

  for (const link of links) {
    const anchorText = link.anchorText
    if (!anchorText) continue

    // Build a case-insensitive regex for the anchor text, escaped for regex safety
    const escapedAnchor = anchorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const anchorRegex = new RegExp(`(${escapedAnchor})`, 'i')

    // Split HTML by protected tags to avoid linking inside them
    const segments = result.split(PROTECTED_TAG_PATTERN)
    let linked = false

    const rebuilt: string[] = []
    for (const segment of segments) {
      // Check if this segment is a protected tag (starts with <a, <h, <img)
      const isProtected = /^<(?:a\b|h[1-6]\b|img\b)/i.test(segment)

      if (!linked && !isProtected && anchorRegex.test(segment)) {
        // Replace the first occurrence in this unprotected segment
        rebuilt.push(
          segment.replace(
            anchorRegex,
            `<a href="${link.url}" title="${anchorText}">$1</a>`
          )
        )
        linked = true
      } else {
        rebuilt.push(segment)
      }
    }

    if (linked) {
      result = rebuilt.join('')
    }
  }

  return result
}

// ---- Silo link map ----

/**
 * Fetch the complete link map for a silo.
 *
 * Returns all articles in the silo with their metadata, plus all
 * silo_links relationships, ready for visualization in a graph UI.
 *
 * @param siloId  The silo UUID
 * @returns       Object with articles array and links array
 */
export async function getSiloLinkMap(siloId: string): Promise<SiloLinkMap> {
  const supabase = getServerClient()

  // Fetch articles in parallel with links
  const [articlesResult, linksResult] = await Promise.all([
    supabase
      .from('seo_articles')
      .select('id, title, keyword, slug, status')
      .eq('silo_id', siloId)
      .order('created_at', { ascending: true }),

    supabase
      .from('seo_silo_links')
      .select('source_article_id, target_article_id, anchor_text, is_bidirectional')
      .eq('silo_id', siloId),
  ])

  if (articlesResult.error) {
    throw new Error(`Failed to fetch silo articles: ${articlesResult.error.message}`)
  }

  if (linksResult.error) {
    throw new Error(`Failed to fetch silo links: ${linksResult.error.message}`)
  }

  return {
    articles: (articlesResult.data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      keyword: a.keyword,
      slug: a.slug,
      status: a.status,
    })),
    links: (linksResult.data ?? []).map((l) => ({
      sourceId: l.source_article_id,
      targetId: l.target_article_id,
      anchorText: l.anchor_text,
      isBidirectional: l.is_bidirectional,
    })),
  }
}

// ---- Save silo links ----

/**
 * Save silo links to the database.
 *
 * Uses a delete-then-insert pattern: removes all existing links for the silo
 * and re-inserts the provided set. This ensures clean state without orphaned links.
 *
 * @param siloId  The silo UUID
 * @param links   Array of link definitions to save
 */
export async function saveSiloLinks(
  siloId: string,
  links: {
    sourceArticleId: string
    targetArticleId: string
    anchorText: string
    isBidirectional: boolean
  }[]
): Promise<void> {
  const supabase = getServerClient()

  // Delete existing links for this silo
  const { error: deleteError } = await supabase
    .from('seo_silo_links')
    .delete()
    .eq('silo_id', siloId)

  if (deleteError) {
    throw new Error(`Failed to delete existing silo links: ${deleteError.message}`)
  }

  // Insert new links (skip if empty)
  if (links.length === 0) return

  const rows = links.map((link) => ({
    silo_id: siloId,
    source_article_id: link.sourceArticleId,
    target_article_id: link.targetArticleId,
    anchor_text: link.anchorText,
    is_bidirectional: link.isBidirectional,
  }))

  const { error: insertError } = await supabase
    .from('seo_silo_links')
    .insert(rows)

  if (insertError) {
    throw new Error(`Failed to insert silo links: ${insertError.message}`)
  }
}

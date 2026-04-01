// ============================================================
// Reverse Backlinks — Semi-Auto Internal Linking (Expert SEO)
// After publishing an article, find 2-3 existing articles on
// the same WP site and inject links back to the new article.
//
// SEO Guidelines enforced:
// - Silo priority: same-silo articles scored 2x higher
// - Link density cap: skip articles with 8+ internal links
// - Paragraph exclusion: never in intro (first 2 <p>), never in last <p>
// - Anchor ≠ exact keyword/title/slug (varied, natural 2-6 words)
// - Max 1 link injected per candidate post
// - No paragraph added just to place a link (wrap_existing only)
// - Skip candidates that already link to the target article
// - Skip paragraphs with 2+ existing links
// - No fallback to random paragraph — relevance required
// - Stopwords excluded from scoring
// ============================================================

import { getAllPublishedPosts, getPostById, updatePost } from '@/lib/wordpress/client'
import { routeAI } from '@/lib/ai/router'

// ---- Types ----

export interface BacklinkSuggestion {
  wp_post_id: number
  wp_post_title: string
  wp_post_url: string
  injection_type: 'wrap_existing' | 'contextual_wrap'
  anchor_text: string
  original_paragraph: string
  modified_paragraph: string
  paragraph_index: number
  relevance_score: number
  status: 'suggested' | 'approved' | 'rejected' | 'injected' | 'rolled_back'
  injected_at?: string
  is_silo_match?: boolean
}

export interface SiloArticleInfo {
  keyword: string
  title: string | null
  slug: string | null
  wp_post_id: number | null
  silo_id: string | null
}

// ---- Constants ----

/** French + common stopwords excluded from scoring */
const STOPWORDS = new Set([
  'les', 'des', 'une', 'dans', 'pour', 'avec', 'sur', 'par', 'qui', 'que',
  'est', 'sont', 'pas', 'plus', 'aussi', 'mais', 'cette', 'ces', 'tout',
  'tous', 'son', 'ses', 'aux', 'elle', 'lui', 'nous', 'vous', 'ils',
  'elles', 'leur', 'entre', 'comme', 'sans', 'chez', 'bien', 'peut',
  'fait', 'tres', 'etre', 'avoir', 'faire', 'dit', 'quand', 'dont',
  'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'from',
])

/** Minimum meaningful word length */
const MIN_WORD_LEN = 4

/** Max existing links allowed in a paragraph to consider it */
const MAX_EXISTING_LINKS_IN_PARA = 2

/** Min score to consider a candidate */
const MIN_CANDIDATE_SCORE = 4

/** Min paragraph relevance score to inject */
const MIN_PARAGRAPH_SCORE = 2

/** Max internal links an article can already have before we skip it */
const MAX_EXISTING_LINKS_IN_POST = 8

/** Silo match scoring bonus multiplier */
const SILO_BONUS_MULTIPLIER = 2

/** Number of intro paragraphs to skip (never place a link there) */
const INTRO_SKIP_PARAGRAPHS = 2

// ---- Helpers ----

function getSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents for matching
    .split(/\s+/)
    .filter(w => w.length >= MIN_WORD_LEN && !STOPWORDS.has(w))
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function countLinksInHtml(html: string): number {
  return (html.match(/<a\s/gi) || []).length
}

/**
 * Count internal links in the full post content (links pointing to the same domain).
 */
function countInternalLinks(htmlContent: string, siteDomain: string): number {
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["']/gi
  let count = 0
  let match
  const domainNorm = siteDomain.replace(/^www\./, '').toLowerCase()
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const href = match[1].toLowerCase()
    // Relative links or same-domain links
    if (href.startsWith('/') || href.includes(domainNorm)) {
      count++
    }
  }
  return count
}

function extractParagraphs(html: string): { text: string; index: number }[] {
  const paragraphs: { text: string; index: number }[] = []
  const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let match
  let idx = 0
  while ((match = regex.exec(html)) !== null) {
    const inner = match[1].trim()
    if (inner.length > 50) {
      paragraphs.push({ text: match[0], index: idx })
    }
    idx++
  }
  return paragraphs
}

/**
 * Extract the site domain from a WP URL.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ---- Scoring ----

/**
 * Score a candidate post for relevance to the new article.
 * Uses significant words only (no stopwords, min 4 chars).
 * Higher score = better candidate for receiving a backlink.
 */
export function scoreCandidate(
  newKeyword: string,
  newTitle: string,
  candidateTitle: string,
  candidateContent: string
): number {
  const keywordWords = getSignificantWords(newKeyword)
  const titleWords = getSignificantWords(newTitle)
  const candidateTitleNorm = candidateTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const candidateContentNorm = candidateContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  let score = 0

  // Keyword word overlap with candidate title (high value)
  for (const w of keywordWords) {
    if (candidateTitleNorm.includes(w)) score += 4
  }

  // Title word overlap with candidate title
  for (const w of titleWords) {
    if (candidateTitleNorm.includes(w)) score += 2
  }

  // Keyword words found in content body (capped)
  for (const w of keywordWords) {
    const matches = candidateContentNorm.split(w).length - 1
    score += Math.min(matches, 3)
  }

  // Title words found in content body (capped)
  for (const w of titleWords) {
    const matches = candidateContentNorm.split(w).length - 1
    score += Math.min(matches, 2)
  }

  return score
}

/**
 * Check if a WP post already contains a link to the target URL.
 */
function alreadyLinksTo(htmlContent: string, targetUrl: string): boolean {
  const normalizedTarget = targetUrl.replace(/\/$/, '').toLowerCase()
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["']/gi
  let match
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const href = match[1].replace(/\/$/, '').toLowerCase()
    if (href === normalizedTarget) return true
  }
  return false
}

// ---- Find Candidates ----

/**
 * Fetch all published WP posts for a site, score them, and return the top 3 candidates.
 *
 * SEO expert rules applied:
 * - Silo articles are scored with a 2x bonus (topical relevance)
 * - Articles with 8+ internal links are skipped (over-optimized)
 * - Self-article is excluded
 * - Articles already linking to the target are excluded
 */
export async function findBacklinkCandidates(
  siteId: string,
  articleKeyword: string,
  articleTitle: string,
  articleWpPostId: number,
  articleWpUrl: string,
  siloArticles?: SiloArticleInfo[]
): Promise<{ id: number; title: string; link: string; score: number; isSiloMatch: boolean }[]> {
  const allPosts = await getAllPublishedPosts(siteId)
  const siteDomain = extractDomain(articleWpUrl)

  // Build a set of WP post IDs that are in the same silo
  const siloWpPostIds = new Set<number>()
  if (siloArticles && siloArticles.length > 0) {
    for (const sa of siloArticles) {
      if (sa.wp_post_id && sa.wp_post_id !== articleWpPostId) {
        siloWpPostIds.add(sa.wp_post_id)
      }
    }
  }

  // Exclude the article itself
  const candidates = allPosts.filter(p => p.id !== articleWpPostId)

  const scored: { id: number; title: string; link: string; score: number; isSiloMatch: boolean }[] = []

  // Fetch content in batches of 5 (limit to 30 for perf — more than before to find silo matches)
  const toFetch = candidates.slice(0, 30)
  console.log(`[reverse-backlinks] Fetching ${toFetch.length} posts from WP (total candidates: ${candidates.length})`)
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(p => getPostById(siteId, p.id))
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'rejected') {
        console.log(`[reverse-backlinks] FAILED to fetch post ${batch[j].id}: ${result.reason}`)
        continue
      }
      if (result.status === 'fulfilled') {
        const post = result.value

        // Skip if already links to the target article
        if (alreadyLinksTo(post.content, articleWpUrl)) {
          console.log(`[reverse-backlinks] Skipping "${post.title}" — already links to ${articleWpUrl}`)
          continue
        }

        // Skip if the article already has too many internal links
        const internalLinkCount = countInternalLinks(post.content, siteDomain)
        if (internalLinkCount >= MAX_EXISTING_LINKS_IN_POST) {
          console.log(`[reverse-backlinks] Skipping "${post.title}" — ${internalLinkCount} internal links (max ${MAX_EXISTING_LINKS_IN_POST})`)
          continue
        }

        let sc = scoreCandidate(articleKeyword, articleTitle, post.title, post.content)
        const isSiloMatch = siloWpPostIds.has(post.id)

        // Silo bonus: same-silo articles get 2x score (topical authority)
        if (isSiloMatch) {
          sc = Math.round(sc * SILO_BONUS_MULTIPLIER)
          console.log(`[reverse-backlinks] Silo match: "${post.title}" — score boosted to ${sc}`)
        }

        console.log(`[reverse-backlinks] Score for "${post.title}" (id=${post.id}): ${sc} (min=${MIN_CANDIDATE_SCORE})`)

        if (sc >= MIN_CANDIDATE_SCORE) {
          scored.push({ id: post.id, title: post.title, link: post.link, score: sc, isSiloMatch })
        }
      }
    }
  }

  // Sort by score desc, return top 3
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3)
}

// ---- Paragraph Selection ----

/**
 * Find the best paragraph in the candidate content that's most relevant
 * to the new article's topic. Returns null if no paragraph is relevant enough.
 *
 * SEO expert rules:
 * - NEVER in intro (skip first 2 paragraphs — intro is sacred for SEO)
 * - NEVER in last paragraph (conclusion = bad placement for internal links)
 * - Skip paragraphs with 2+ existing links (avoid link stacking)
 * - Skip paragraphs where no significant keyword word appears
 * - No fallback to random paragraph — relevance is required
 */
function findBestParagraph(
  paragraphs: { text: string; index: number }[],
  keyword: string
): { text: string; index: number; score: number } | null {
  const words = getSignificantWords(keyword)
  let bestScore = 0
  let bestPara: { text: string; index: number; score: number } | null = null

  // Determine exclusion zones
  const totalParagraphs = paragraphs.length
  if (totalParagraphs < 4) return null // Not enough paragraphs for safe placement

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    // RULE: Skip intro paragraphs (first 2 real paragraphs)
    if (para.index < INTRO_SKIP_PARAGRAPHS) continue

    // RULE: Skip the last paragraph (conclusion zone)
    if (i === paragraphs.length - 1) continue

    // RULE: Skip paragraphs with too many existing links
    if (countLinksInHtml(para.text) >= MAX_EXISTING_LINKS_IN_PARA) continue

    const plain = stripHtml(para.text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    let score = 0
    for (const w of words) {
      if (plain.includes(w)) score++
    }

    // Prefer paragraphs in the middle of the article (body zone)
    // Give a small boost to paragraphs not near the edges
    const relativePosition = para.index / totalParagraphs
    if (relativePosition >= 0.2 && relativePosition <= 0.8) {
      score += 1 // Slight bonus for body zone
    }

    if (score > bestScore) {
      bestScore = score
      bestPara = { ...para, score }
    }
  }

  // Only return if minimum relevance is met
  if (bestPara && bestPara.score >= MIN_PARAGRAPH_SCORE) {
    return bestPara
  }

  return null
}

// ---- Anchor Text Generation ----

/**
 * Generate a natural anchor text that is NOT the exact keyword or title.
 * Uses AI to create a 2-6 word varied anchor within the paragraph context.
 */
async function generateNaturalAnchor(
  keyword: string,
  title: string,
  paragraphText: string,
  targetUrl: string
): Promise<{ anchor: string; modifiedParagraph: string } | null> {
  const plainPara = stripHtml(paragraphText)

  const aiResponse = await routeAI(
    'generate_backlink_anchor',
    [
      {
        role: 'user',
        content: `Tu es un expert SEO en maillage interne. Dans le paragraphe suivant, identifie une expression naturelle de 2-6 mots deja presente dans le texte qui est thematiquement liee au sujet cible, puis transforme-la en lien.

Paragraphe :
"${plainPara.slice(0, 800)}"

Sujet cible : "${keyword}" (titre : "${title}")
URL cible : ${targetUrl}

Regles STRICTES :
- L'ancre doit etre une expression DEJA PRESENTE dans le paragraphe (pas un mot ajoute)
- L'ancre NE DOIT PAS etre le keyword exact "${keyword}" ni le titre exact "${title}"
- L'ancre = 2-6 mots, expression naturelle liee thematiquement au sujet cible
- Privilegier une expression qui inclut un mot-cle ou synonyme du sujet cible
- Le lien doit etre INVISIBLE pour le lecteur (pas de rupture de ton)
- Si aucune expression naturelle ne convient, reponds {"impossible": true}

JSON : { "anchor_text": "expression choisie", "impossible": false }
OU : { "impossible": true }`,
      },
    ]
  )

  try {
    // Clean AI response: strip markdown code blocks and extract JSON
    let rawContent = aiResponse.content.trim()
    // Strip ```json ... ``` or ``` ... ``` wrappers
    const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      rawContent = fenceMatch[1].trim()
    }
    // If still not starting with {, try to find the first { ... } block
    if (!rawContent.startsWith('{')) {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        rawContent = jsonMatch[0]
      }
    }

    const parsed = JSON.parse(rawContent)
    if (parsed.impossible) return null

    const anchor = parsed.anchor_text
    if (!anchor || anchor.length < 3) return null

    // Verify anchor is not the exact keyword or title
    const anchorLower = anchor.toLowerCase().trim()
    if (anchorLower === keyword.toLowerCase().trim()) return null
    if (anchorLower === title.toLowerCase().trim()) return null

    // Find and wrap the anchor in the paragraph HTML
    const anchorRegex = new RegExp(
      `(?<![">])${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![<"])`,
      'i'
    )
    const modified = paragraphText.replace(
      anchorRegex,
      `<a href="${targetUrl}">$&</a>`
    )

    // Check that replacement actually happened
    if (modified === paragraphText) return null

    return { anchor, modifiedParagraph: modified }
  } catch {
    console.error('[reverse-backlinks] Failed to parse anchor AI response (full):', aiResponse.content.slice(0, 500))
    return null
  }
}

// ---- Generate Suggestion ----

/**
 * Generate a backlink suggestion for a single candidate post.
 *
 * Strategy: wrap_existing or contextual_wrap only (never add new paragraphs).
 * - If keyword words are found in a paragraph, use AI to pick a natural varied anchor
 * - The anchor is always an expression already in the text, never added
 * - Falls back to null if no natural placement is possible
 */
export async function generateBacklinkSuggestion(
  article: { keyword: string; title: string; wpUrl: string },
  candidate: { id: number; title: string; link: string; isSiloMatch?: boolean },
  siteId: string
): Promise<BacklinkSuggestion | null> {
  // Fetch full content
  const post = await getPostById(siteId, candidate.id)

  // Double-check: skip if already links to target
  if (alreadyLinksTo(post.content, article.wpUrl)) {
    console.log(`[reverse-backlinks] generateSuggestion: post ${candidate.id} already links to target`)
    return null
  }

  const paragraphs = extractParagraphs(post.content)
  console.log(`[reverse-backlinks] generateSuggestion: post ${candidate.id} has ${paragraphs.length} eligible paragraphs`)
  if (paragraphs.length === 0) return null

  // Find best relevant paragraph (respects intro/conclusion exclusion)
  const bestPara = findBestParagraph(paragraphs, article.keyword)
  if (!bestPara) {
    console.log(`[reverse-backlinks] generateSuggestion: no suitable paragraph found in post ${candidate.id}`)
    return null
  }
  console.log(`[reverse-backlinks] generateSuggestion: best paragraph index=${bestPara.index}, score=${bestPara.score}`)

  // Use AI to find natural anchor text and wrap it
  const result = await generateNaturalAnchor(
    article.keyword,
    article.title,
    bestPara.text,
    article.wpUrl
  )

  if (!result) {
    console.log(`[reverse-backlinks] generateSuggestion: AI anchor generation failed for post ${candidate.id}`)
    return null
  }
  console.log(`[reverse-backlinks] generateSuggestion: anchor="${result.anchor}" for post ${candidate.id}`)

  return {
    wp_post_id: candidate.id,
    wp_post_title: candidate.title,
    wp_post_url: candidate.link,
    injection_type: 'contextual_wrap',
    anchor_text: result.anchor,
    original_paragraph: bestPara.text,
    modified_paragraph: result.modifiedParagraph,
    paragraph_index: bestPara.index,
    relevance_score: bestPara.score,
    status: 'suggested',
    is_silo_match: candidate.isSiloMatch || false,
  }
}

// ---- Inject / Rollback ----

/**
 * Inject a backlink into a WordPress post by replacing the paragraph at the given index.
 */
export async function injectBacklink(
  siteId: string,
  wpPostId: number,
  paragraphIndex: number,
  originalParagraph: string,
  modifiedParagraph: string
): Promise<void> {
  const post = await getPostById(siteId, wpPostId)
  let content = post.content

  // Find the paragraph by matching the original text
  if (content.includes(originalParagraph)) {
    content = content.replace(originalParagraph, modifiedParagraph)
  } else {
    // Fallback: try to find by index
    const paragraphs: string[] = []
    const regex = /<p[^>]*>[\s\S]*?<\/p>/gi
    let match
    while ((match = regex.exec(post.content)) !== null) {
      paragraphs.push(match[0])
    }

    if (paragraphs[paragraphIndex]) {
      content = content.replace(paragraphs[paragraphIndex], modifiedParagraph)
    } else {
      throw new Error(`Paragraphe introuvable dans le post ${wpPostId}`)
    }
  }

  await updatePost(siteId, wpPostId, { content })
}

/**
 * Rollback a backlink injection by restoring the original paragraph.
 */
export async function rollbackBacklink(
  siteId: string,
  wpPostId: number,
  _paragraphIndex: number,
  originalParagraph: string,
  modifiedParagraph: string
): Promise<void> {
  const post = await getPostById(siteId, wpPostId)
  let content = post.content

  if (content.includes(modifiedParagraph)) {
    content = content.replace(modifiedParagraph, originalParagraph)
  } else {
    throw new Error(`Paragraphe modifie introuvable dans le post ${wpPostId} — le contenu a peut-etre change manuellement`)
  }

  await updatePost(siteId, wpPostId, { content })
}

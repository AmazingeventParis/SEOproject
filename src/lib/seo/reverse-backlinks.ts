// ============================================================
// Reverse Backlinks — Semi-Auto Internal Linking
// After publishing an article, find 2-3 existing articles on
// the same WP site and inject links back to the new article.
// ============================================================

import { getAllPublishedPosts, getPostById, updatePost } from '@/lib/wordpress/client'
import { routeAI } from '@/lib/ai/router'

// ---- Types ----

export interface BacklinkSuggestion {
  wp_post_id: number
  wp_post_title: string
  wp_post_url: string
  injection_type: 'wrap_existing' | 'add_sentences'
  anchor_text: string
  original_paragraph: string
  modified_paragraph: string
  paragraph_index: number
  status: 'suggested' | 'approved' | 'rejected' | 'injected' | 'rolled_back'
  injected_at?: string
}

// ---- Scoring ----

/**
 * Score a candidate post for relevance to the new article.
 * Higher score = better candidate for receiving a backlink.
 */
export function scoreCandidate(
  newKeyword: string,
  newTitle: string,
  candidateTitle: string,
  candidateContent: string
): number {
  const keywordWords = newKeyword.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const titleWords = newTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const candidateTitleLower = candidateTitle.toLowerCase()
  const candidateContentLower = candidateContent.toLowerCase()

  let score = 0

  // Keyword word overlap with candidate title (high value)
  for (const w of keywordWords) {
    if (candidateTitleLower.includes(w)) score += 3
  }

  // Title word overlap with candidate title
  for (const w of titleWords) {
    if (candidateTitleLower.includes(w)) score += 2
  }

  // Keyword words found in content body
  for (const w of keywordWords) {
    const matches = candidateContentLower.split(w).length - 1
    score += Math.min(matches, 3) // cap at 3 occurrences per word
  }

  // Title words found in content body
  for (const w of titleWords) {
    const matches = candidateContentLower.split(w).length - 1
    score += Math.min(matches, 2)
  }

  return score
}

// ---- Find Candidates ----

/**
 * Fetch all published WP posts for a site, score them, and return the top 3 candidates.
 * Excludes the article's own WP post.
 */
export async function findBacklinkCandidates(
  siteId: string,
  articleKeyword: string,
  articleTitle: string,
  articleWpPostId: number
): Promise<{ id: number; title: string; link: string; score: number }[]> {
  const allPosts = await getAllPublishedPosts(siteId)

  // Exclude the article itself
  const candidates = allPosts.filter(p => p.id !== articleWpPostId)

  // We need content for scoring — fetch it in parallel (limit to 20 for perf)
  const toFetch = candidates.slice(0, 20)
  const scored: { id: number; title: string; link: string; score: number }[] = []

  // Fetch content in batches of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(p => getPostById(siteId, p.id))
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled') {
        const post = result.value
        const sc = scoreCandidate(articleKeyword, articleTitle, post.title, post.content)
        if (sc > 0) {
          scored.push({ id: post.id, title: post.title, link: post.link, score: sc })
        }
      }
    }
  }

  // Sort by score desc, return top 3
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3)
}

// ---- Generate Suggestion ----

/**
 * Extract paragraphs from HTML content.
 * Returns an array of { text, index } where text is the raw paragraph HTML.
 */
function extractParagraphs(html: string): { text: string; index: number }[] {
  const paragraphs: { text: string; index: number }[] = []
  const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let match
  let idx = 0
  while ((match = regex.exec(html)) !== null) {
    const inner = match[1].trim()
    // Skip very short paragraphs or empty ones
    if (inner.length > 50) {
      paragraphs.push({ text: match[0], index: idx })
    }
    idx++
  }
  return paragraphs
}

/**
 * Strip HTML tags for text comparison.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Find the best paragraph in the candidate content that's most relevant to the new article's keyword.
 */
function findBestParagraph(
  paragraphs: { text: string; index: number }[],
  keyword: string
): { text: string; index: number } | null {
  const words = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  let bestScore = 0
  let bestPara: { text: string; index: number } | null = null

  for (const para of paragraphs) {
    const plain = stripHtml(para.text).toLowerCase()
    // Skip paragraphs that already contain a link to avoid stacking
    if (/<a\s/i.test(para.text) && (para.text.match(/<a\s/gi) || []).length >= 2) continue

    let score = 0
    for (const w of words) {
      if (plain.includes(w)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestPara = para
    }
  }

  // If no keyword match, pick a paragraph from the middle of the article
  if (!bestPara && paragraphs.length > 2) {
    const midIndex = Math.floor(paragraphs.length / 2)
    bestPara = paragraphs[midIndex]
  }

  return bestPara
}

/**
 * Generate a backlink suggestion for a single candidate post.
 */
export async function generateBacklinkSuggestion(
  article: { keyword: string; title: string; wpUrl: string },
  candidate: { id: number; title: string; link: string },
  siteId: string
): Promise<BacklinkSuggestion | null> {
  // Fetch full content
  const post = await getPostById(siteId, candidate.id)
  const paragraphs = extractParagraphs(post.content)

  if (paragraphs.length === 0) return null

  const keywordWords = article.keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2)

  // Check if keyword or close variant already exists in a paragraph
  const bestPara = findBestParagraph(paragraphs, article.keyword)
  if (!bestPara) return null

  const plainText = stripHtml(bestPara.text).toLowerCase()
  const keywordFound = keywordWords.length > 0 && keywordWords.every(w => plainText.includes(w))

  if (keywordFound) {
    // wrap_existing: wrap the keyword occurrence with a link
    const keywordPattern = new RegExp(
      `(${keywordWords.join('\\s+')})`,
      'i'
    )
    const modified = bestPara.text.replace(
      keywordPattern,
      `<a href="${article.wpUrl}">$1</a>`
    )

    // Extract anchor text from match
    const anchorMatch = plainText.match(new RegExp(keywordWords.join('\\s+'), 'i'))
    const anchorText = anchorMatch ? anchorMatch[0] : article.keyword

    return {
      wp_post_id: candidate.id,
      wp_post_title: candidate.title,
      wp_post_url: candidate.link,
      injection_type: 'wrap_existing',
      anchor_text: anchorText,
      original_paragraph: bestPara.text,
      modified_paragraph: modified,
      paragraph_index: bestPara.index,
      status: 'suggested',
    }
  }

  // add_sentences: use AI to generate transition sentences
  const aiResponse = await routeAI(
    'generate_backlink_sentences',
    [
      {
        role: 'user',
        content: `Tu es un redacteur SEO. Ajoute 1-2 phrases de transition dans un article existant pour integrer un lien vers un nouvel article.

Article existant : "${candidate.title}"
Paragraphe contexte : "${stripHtml(bestPara.text).slice(0, 500)}"

Nouvel article : "${article.title}" (${article.keyword})
URL : ${article.wpUrl}

Regles :
- 1-2 phrases qui s'inserent APRES le paragraphe contexte
- Lien en <a href="${article.wpUrl}">ancre variee</a>
- Meme ton que l'article existant
- Pas de "pour en savoir plus" / "decouvrez"
- Apporte de la valeur informationnelle

JSON : { "sentences_html": "<p>...</p>", "anchor_text": "..." }`,
      },
    ]
  )

  try {
    const parsed = JSON.parse(aiResponse.content)
    const sentencesHtml = parsed.sentences_html || parsed.sentences || ''
    const anchorText = parsed.anchor_text || article.keyword

    if (!sentencesHtml) return null

    // Modified = original paragraph + AI sentences
    const modified = bestPara.text + '\n' + sentencesHtml

    return {
      wp_post_id: candidate.id,
      wp_post_title: candidate.title,
      wp_post_url: candidate.link,
      injection_type: 'add_sentences',
      anchor_text: anchorText,
      original_paragraph: bestPara.text,
      modified_paragraph: modified,
      paragraph_index: bestPara.index,
      status: 'suggested',
    }
  } catch {
    console.error('[reverse-backlinks] Failed to parse AI response:', aiResponse.content)
    return null
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
  paragraphIndex: number,
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

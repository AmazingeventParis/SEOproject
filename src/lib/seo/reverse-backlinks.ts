// ============================================================
// Reverse Backlinks — Semi-Auto Internal Linking (Expert SEO)
// After publishing an article, find 2-3 existing articles on
// the same WP site and inject links back to the new article.
//
// SEO Guidelines enforced:
// - Category filter: ONLY articles sharing a WP category (same topic)
// - Silo priority: same-silo articles scored 2x higher
// - Link density cap: skip articles with 8+ internal links
// - Paragraph exclusion: never in intro (first 2 <p>), never in last <p>
// - Anchor ≠ exact keyword/title/slug (varied, natural 2-6 words)
// - Max 1 link injected per candidate post
// - If no natural anchor: add 1-2 transitional sentences (contextual_add)
// - Skip candidates that already link to the target article
// - Skip paragraphs with 2+ existing links
// - Stopwords excluded from scoring
// ============================================================

import { getAllPublishedPosts, getPostById, updatePost } from '@/lib/wordpress/client'
import { routeAI } from '@/lib/ai/router'

// ---- Types ----

export interface BacklinkSuggestion {
  wp_post_id: number
  wp_post_title: string
  wp_post_url: string
  injection_type: 'wrap_existing' | 'contextual_wrap' | 'contextual_add'
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

  for (const w of keywordWords) {
    if (candidateTitleNorm.includes(w)) score += 4
  }
  for (const w of titleWords) {
    if (candidateTitleNorm.includes(w)) score += 2
  }
  for (const w of keywordWords) {
    const matches = candidateContentNorm.split(w).length - 1
    score += Math.min(matches, 3)
  }
  for (const w of titleWords) {
    const matches = candidateContentNorm.split(w).length - 1
    score += Math.min(matches, 2)
  }

  return score
}

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
 * SEO expert rules:
 * - CATEGORY FILTER: only candidates sharing at least 1 WP category with the source article
 * - Silo articles scored with 2x bonus
 * - Articles with 8+ internal links are skipped
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

  // Get the source article's WP categories
  const sourcePost = allPosts.find(p => p.id === articleWpPostId)
  const sourceCategories = new Set(sourcePost?.categories || [])

  // If source has no categories, fetch them directly
  if (sourceCategories.size === 0) {
    try {
      const fullPost = await getPostById(siteId, articleWpPostId)
      for (const catId of fullPost.categories) {
        sourceCategories.add(catId)
      }
    } catch {
      console.warn(`[reverse-backlinks] Could not fetch source article categories`)
    }
  }

  console.log(`[reverse-backlinks] Source article categories: [${Array.from(sourceCategories).join(', ')}] (${sourceCategories.size} categories)`)

  // Build silo WP post ID set
  const siloWpPostIds = new Set<number>()
  if (siloArticles && siloArticles.length > 0) {
    for (const sa of siloArticles) {
      if (sa.wp_post_id && sa.wp_post_id !== articleWpPostId) {
        siloWpPostIds.add(sa.wp_post_id)
      }
    }
  }

  // STEP 1: Filter candidates by CATEGORY (same topic only)
  const sameCategoryCandidates = allPosts.filter(p => {
    if (p.id === articleWpPostId) return false
    // Must share at least 1 category with the source article
    if (sourceCategories.size === 0) return true // No categories = no filter (fallback)
    return p.categories.some(catId => sourceCategories.has(catId))
  })

  console.log(`[reverse-backlinks] ${sameCategoryCandidates.length} candidates in same category (out of ${allPosts.length - 1} total)`)

  const scored: { id: number; title: string; link: string; score: number; isSiloMatch: boolean }[] = []

  // Fetch content in batches of 5 (limit to 30 for perf)
  const toFetch = sameCategoryCandidates.slice(0, 30)
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(p => getPostById(siteId, p.id))
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'rejected') {
        console.warn(`[reverse-backlinks] Failed to fetch post ${batch[j].id}: ${result.reason}`)
        continue
      }
      if (result.status === 'fulfilled') {
        const post = result.value

        if (alreadyLinksTo(post.content, articleWpUrl)) continue

        const internalLinkCount = countInternalLinks(post.content, siteDomain)
        if (internalLinkCount >= MAX_EXISTING_LINKS_IN_POST) {
          console.log(`[reverse-backlinks] Skipping "${post.title}" — ${internalLinkCount} internal links (max ${MAX_EXISTING_LINKS_IN_POST})`)
          continue
        }

        let sc = scoreCandidate(articleKeyword, articleTitle, post.title, post.content)
        const isSiloMatch = siloWpPostIds.has(post.id)

        if (isSiloMatch) {
          sc = Math.round(sc * SILO_BONUS_MULTIPLIER)
        }

        if (sc >= MIN_CANDIDATE_SCORE) {
          scored.push({ id: post.id, title: post.title, link: post.link, score: sc, isSiloMatch })
        }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score)
  console.log(`[reverse-backlinks] Top candidates: ${scored.slice(0, 5).map(c => `"${c.title}" (score:${c.score}, silo:${c.isSiloMatch})`).join(', ')}`)
  return scored.slice(0, 3)
}

// ---- Paragraph Selection ----

/**
 * Find the best paragraph in the candidate content for link placement.
 *
 * SEO rules:
 * - NEVER in intro (skip first 2 paragraphs)
 * - NEVER in last paragraph (conclusion)
 * - Skip paragraphs with 2+ existing links
 * - Prefer body zone (20-80% of article)
 */
function findBestParagraph(
  paragraphs: { text: string; index: number }[],
  keyword: string
): { text: string; index: number; score: number } | null {
  const words = getSignificantWords(keyword)
  let bestScore = 0
  let bestPara: { text: string; index: number; score: number } | null = null

  const totalParagraphs = paragraphs.length
  if (totalParagraphs < 4) return null

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    if (para.index < INTRO_SKIP_PARAGRAPHS) continue
    if (i === paragraphs.length - 1) continue
    if (countLinksInHtml(para.text) >= MAX_EXISTING_LINKS_IN_PARA) continue

    const plain = stripHtml(para.text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    let score = 0
    for (const w of words) {
      if (plain.includes(w)) score++
    }

    const relativePosition = para.index / totalParagraphs
    if (relativePosition >= 0.2 && relativePosition <= 0.8) {
      score += 1
    }

    if (score > bestScore) {
      bestScore = score
      bestPara = { ...para, score }
    }
  }

  if (bestPara && bestPara.score >= MIN_PARAGRAPH_SCORE) {
    return bestPara
  }

  return null
}

/**
 * Find a suitable paragraph for adding sentences (less strict than anchor wrapping).
 * Used as fallback when no natural anchor is found.
 * Picks a thematically relevant paragraph in the body zone.
 */
function findParagraphForSentenceAdd(
  paragraphs: { text: string; index: number }[],
  keyword: string
): { text: string; index: number; score: number } | null {
  const words = getSignificantWords(keyword)
  let bestScore = -1
  let bestPara: { text: string; index: number; score: number } | null = null

  const totalParagraphs = paragraphs.length
  if (totalParagraphs < 4) return null

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    // Still respect intro and conclusion exclusion
    if (para.index < INTRO_SKIP_PARAGRAPHS) continue
    if (i === paragraphs.length - 1) continue
    // Less strict on existing links — we're adding after, not inside
    if (countLinksInHtml(para.text) >= 3) continue

    const plain = stripHtml(para.text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    let score = 0
    for (const w of words) {
      if (plain.includes(w)) score++
    }

    // Prefer middle body zone
    const relativePosition = para.index / totalParagraphs
    if (relativePosition >= 0.3 && relativePosition <= 0.7) {
      score += 2
    } else if (relativePosition >= 0.2 && relativePosition <= 0.8) {
      score += 1
    }

    if (score > bestScore) {
      bestScore = score
      bestPara = { ...para, score }
    }
  }

  // Accept even score 0 paragraphs for sentence add (we're creating the context)
  return bestPara
}

// ---- Anchor Text Generation ----

/**
 * Wrap an anchor text found in a paragraph with a link tag.
 * Returns null if the text is not found or is already inside a link.
 */
function wrapAnchorInParagraph(
  paragraphHtml: string,
  anchorText: string,
  targetUrl: string
): string | null {
  const anchorRegex = new RegExp(
    `(?<![">])${anchorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![<"])`,
    'i'
  )
  const modified = paragraphHtml.replace(
    anchorRegex,
    `<a href="${targetUrl}">$&</a>`
  )
  if (modified === paragraphHtml) return null
  return modified
}

/**
 * Strategy 1: Exact match — find the exact keyword already present in the paragraph.
 * Best SEO practice: exact-match anchor is the strongest signal.
 */
function tryExactAnchor(
  paragraphHtml: string,
  keyword: string,
  targetUrl: string
): { anchor: string; modifiedParagraph: string } | null {
  const modified = wrapAnchorInParagraph(paragraphHtml, keyword, targetUrl)
  if (modified) {
    console.log(`[reverse-backlinks] ✓ Exact anchor found: "${keyword}"`)
    return { anchor: keyword, modifiedParagraph: modified }
  }
  return null
}

/**
 * Strategy 2: Semi-exact match — find a significant sub-expression of the keyword
 * already present in the paragraph (e.g., "thermostat connecté" found when
 * keyword is "thermostat connecté heatzy").
 * Tries longest sub-expressions first for maximum relevance.
 */
function trySemiExactAnchor(
  paragraphHtml: string,
  keyword: string,
  targetUrl: string
): { anchor: string; modifiedParagraph: string } | null {
  const words = keyword.split(/\s+/).filter(w => w.length >= 3)
  if (words.length < 2) return null

  // Generate sub-expressions from longest to shortest (minimum 2 words)
  const candidates: string[] = []
  for (let len = words.length - 1; len >= 2; len--) {
    for (let start = 0; start <= words.length - len; start++) {
      candidates.push(words.slice(start, start + len).join(' '))
    }
  }

  for (const candidate of candidates) {
    const modified = wrapAnchorInParagraph(paragraphHtml, candidate, targetUrl)
    if (modified) {
      console.log(`[reverse-backlinks] ✓ Semi-exact anchor found: "${candidate}"`)
      return { anchor: candidate, modifiedParagraph: modified }
    }
  }

  return null
}

/**
 * Strategy 3: AI thematic anchor — ask the AI to identify a relevant expression
 * already in the text. Exact keyword and partial matches are welcome.
 */
async function generateThematicAnchor(
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
        content: `Tu es un expert SEO en maillage interne. Dans le paragraphe suivant, identifie la meilleure expression de 2-6 mots DEJA PRESENTE dans le texte pour servir d'ancre vers l'article cible.

Paragraphe :
"${plainPara.slice(0, 800)}"

Sujet cible : "${keyword}" (titre : "${title}")
URL cible : ${targetUrl}

PRIORITE DES ANCRES (du meilleur au moins bon) :
1. ANCRE EXACTE : le mot-cle "${keyword}" tel quel s'il est present dans le texte
2. ANCRE SEMI-EXACTE : une partie du mot-cle (ex: "thermostat connecte" si le keyword est "thermostat connecte heatzy")
3. ANCRE THEMATIQUE : un synonyme ou expression du meme champ semantique (ex: "regulation du chauffage" pour un article sur les thermostats)

Regles :
- L'ancre DOIT etre une expression DEJA PRESENTE dans le paragraphe (mot pour mot)
- 2-6 mots, pas de mot isole
- Le lien doit etre naturel pour le lecteur
- Si aucune expression pertinente ne convient, reponds {"impossible": true}

JSON : { "anchor_text": "expression choisie", "anchor_type": "exact|semi_exact|thematic", "impossible": false }
OU : { "impossible": true }`,
      },
    ]
  )

  try {
    let rawContent = aiResponse.content.trim()
    const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) rawContent = fenceMatch[1].trim()
    if (!rawContent.startsWith('{')) {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) rawContent = jsonMatch[0]
    }

    const parsed = JSON.parse(rawContent)
    if (parsed.impossible) return null

    const anchor = parsed.anchor_text
    if (!anchor || anchor.length < 3) return null

    const modified = wrapAnchorInParagraph(paragraphText, anchor, targetUrl)
    if (!modified) return null

    console.log(`[reverse-backlinks] ✓ AI thematic anchor found: "${anchor}" (type: ${parsed.anchor_type || 'unknown'})`)
    return { anchor, modifiedParagraph: modified }
  } catch {
    console.error('[reverse-backlinks] Failed to parse anchor AI response:', JSON.stringify(aiResponse.content.slice(0, 500)))
    return null
  }
}

// ---- Sentence Addition (fallback) ----

/**
 * Generate 1-2 transitional sentences that naturally introduce a link to the target article.
 * Used when no natural anchor text is found in existing content.
 */
async function generateTransitionalSentences(
  keyword: string,
  title: string,
  paragraphText: string,
  targetUrl: string,
  candidateTitle: string
): Promise<{ anchor: string; modifiedParagraph: string } | null> {
  const plainPara = stripHtml(paragraphText)

  const aiResponse = await routeAI(
    'generate_backlink_sentences',
    [
      {
        role: 'user',
        content: `Tu es un expert SEO en maillage interne. Tu dois ajouter 1-2 phrases de TRANSITION apres le paragraphe ci-dessous pour creer un lien naturel vers un article connexe.

PARAGRAPHE EXISTANT :
"${plainPara.slice(0, 600)}"

ARTICLE HOTE (celui qu'on modifie) : "${candidateTitle}"
ARTICLE CIBLE A LINKER : "${title}" (mot-cle : "${keyword}")
URL CIBLE : ${targetUrl}

CONTEXTE : L'article cible traite de "${keyword}". Tu dois comprendre ce sujet pour creer une transition logique depuis le paragraphe existant vers ce sujet.

REGLES STRICTES :
- Genere 1-2 phrases MAX (40 mots max au total) qui font la TRANSITION entre le sujet du paragraphe et le sujet de l'article cible
- La transition doit etre NATURELLE et LOGIQUE : le lecteur ne doit pas sentir qu'on force un lien
- Inclus UN lien <a href="${targetUrl}">ancre de 2-6 mots</a> dans ces phrases
- PRIORITE ANCRE : utilise le mot-cle exact "${keyword}" comme ancre si possible, sinon une variante proche ou un synonyme naturel
- Le ton doit correspondre au reste du paragraphe
- Ces phrases s'ajoutent APRES le paragraphe, pas dedans
- Exemples de bonnes transitions :
  * "Pour aller plus loin, decouvrez notre <a href="URL">${keyword}</a> en detail."
  * "Ce point rejoint d'ailleurs la question du <a href="URL">pilotage intelligent du chauffage</a>, un sujet que nous avons detaille."

JSON : { "sentences": "1-2 phrases avec le lien HTML inclus", "anchor_text": "texte de l'ancre seul", "impossible": false }
OU : { "impossible": true }`,
      },
    ]
  )

  try {
    let rawContent = aiResponse.content.trim()
    const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) rawContent = fenceMatch[1].trim()
    if (!rawContent.startsWith('{')) {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) rawContent = jsonMatch[0]
    }

    const parsed = JSON.parse(rawContent)
    if (parsed.impossible) return null

    const sentences = parsed.sentences
    const anchor = parsed.anchor_text
    if (!sentences || !anchor) return null

    // Verify the sentences contain the target URL
    if (!sentences.includes(targetUrl)) return null

    // Add the sentences as a new <p> after the existing paragraph
    const modifiedParagraph = `${paragraphText}\n<p>${sentences}</p>`

    return { anchor, modifiedParagraph }
  } catch {
    console.error('[reverse-backlinks] Failed to parse transitional sentences AI response:', JSON.stringify(aiResponse.content.slice(0, 500)))
    return null
  }
}

// ---- Generate Suggestion ----

/**
 * Generate a backlink suggestion for a single candidate post.
 *
 * Strategy (in priority order — expert SEO best practices):
 * 1. EXACT ANCHOR: keyword found verbatim in existing text → wrap it
 * 2. SEMI-EXACT ANCHOR: partial keyword match in existing text → wrap it
 * 3. THEMATIC ANCHOR (AI): AI finds a semantically related expression → wrap it
 * 4. TRANSITIONAL SENTENCES: no anchor possible → create 1-2 phrases with link
 */
export async function generateBacklinkSuggestion(
  article: { keyword: string; title: string; wpUrl: string },
  candidate: { id: number; title: string; link: string; isSiloMatch?: boolean },
  siteId: string
): Promise<BacklinkSuggestion | null> {
  const post = await getPostById(siteId, candidate.id)

  if (alreadyLinksTo(post.content, article.wpUrl)) return null

  const paragraphs = extractParagraphs(post.content)
  if (paragraphs.length === 0) return null

  // Get eligible paragraphs (respects intro/conclusion exclusion, link density)
  const bestPara = findBestParagraph(paragraphs, article.keyword)

  if (bestPara) {
    // Strategy 1: EXACT ANCHOR — keyword found verbatim
    const exactResult = tryExactAnchor(bestPara.text, article.keyword, article.wpUrl)
    if (exactResult) {
      return {
        wp_post_id: candidate.id,
        wp_post_title: candidate.title,
        wp_post_url: candidate.link,
        injection_type: 'wrap_existing',
        anchor_text: exactResult.anchor,
        original_paragraph: bestPara.text,
        modified_paragraph: exactResult.modifiedParagraph,
        paragraph_index: bestPara.index,
        relevance_score: bestPara.score + 10, // Exact match bonus
        status: 'suggested',
        is_silo_match: candidate.isSiloMatch || false,
      }
    }

    // Strategy 2: SEMI-EXACT ANCHOR — partial keyword match
    const semiResult = trySemiExactAnchor(bestPara.text, article.keyword, article.wpUrl)
    if (semiResult) {
      return {
        wp_post_id: candidate.id,
        wp_post_title: candidate.title,
        wp_post_url: candidate.link,
        injection_type: 'wrap_existing',
        anchor_text: semiResult.anchor,
        original_paragraph: bestPara.text,
        modified_paragraph: semiResult.modifiedParagraph,
        paragraph_index: bestPara.index,
        relevance_score: bestPara.score + 5, // Semi-exact bonus
        status: 'suggested',
        is_silo_match: candidate.isSiloMatch || false,
      }
    }

    // Strategy 3: AI THEMATIC ANCHOR — AI finds a related expression
    const thematicResult = await generateThematicAnchor(
      article.keyword,
      article.title,
      bestPara.text,
      article.wpUrl
    )
    if (thematicResult) {
      return {
        wp_post_id: candidate.id,
        wp_post_title: candidate.title,
        wp_post_url: candidate.link,
        injection_type: 'contextual_wrap',
        anchor_text: thematicResult.anchor,
        original_paragraph: bestPara.text,
        modified_paragraph: thematicResult.modifiedParagraph,
        paragraph_index: bestPara.index,
        relevance_score: bestPara.score,
        status: 'suggested',
        is_silo_match: candidate.isSiloMatch || false,
      }
    }
  }

  // Also try exact/semi-exact on ALL eligible paragraphs (not just the best-scored one)
  // The keyword might appear in a different paragraph than the highest-scored one
  const totalParagraphs = paragraphs.length
  if (totalParagraphs >= 4) {
    for (const para of paragraphs) {
      if (para.index < INTRO_SKIP_PARAGRAPHS) continue
      if (para === paragraphs[paragraphs.length - 1]) continue
      if (countLinksInHtml(para.text) >= MAX_EXISTING_LINKS_IN_PARA) continue
      if (bestPara && para.index === bestPara.index) continue // Already tried

      const exactResult = tryExactAnchor(para.text, article.keyword, article.wpUrl)
      if (exactResult) {
        return {
          wp_post_id: candidate.id,
          wp_post_title: candidate.title,
          wp_post_url: candidate.link,
          injection_type: 'wrap_existing',
          anchor_text: exactResult.anchor,
          original_paragraph: para.text,
          modified_paragraph: exactResult.modifiedParagraph,
          paragraph_index: para.index,
          relevance_score: 10,
          status: 'suggested',
          is_silo_match: candidate.isSiloMatch || false,
        }
      }

      const semiResult = trySemiExactAnchor(para.text, article.keyword, article.wpUrl)
      if (semiResult) {
        return {
          wp_post_id: candidate.id,
          wp_post_title: candidate.title,
          wp_post_url: candidate.link,
          injection_type: 'wrap_existing',
          anchor_text: semiResult.anchor,
          original_paragraph: para.text,
          modified_paragraph: semiResult.modifiedParagraph,
          paragraph_index: para.index,
          relevance_score: 5,
          status: 'suggested',
          is_silo_match: candidate.isSiloMatch || false,
        }
      }
    }
  }

  // Strategy 4: TRANSITIONAL SENTENCES — no anchor anywhere → create sentences
  console.log(`[reverse-backlinks] No anchor found in "${candidate.title}" — trying sentence addition`)
  const sentencePara = findParagraphForSentenceAdd(paragraphs, article.keyword)
  if (sentencePara) {
    const result = await generateTransitionalSentences(
      article.keyword,
      article.title,
      sentencePara.text,
      article.wpUrl,
      candidate.title
    )

    if (result) {
      return {
        wp_post_id: candidate.id,
        wp_post_title: candidate.title,
        wp_post_url: candidate.link,
        injection_type: 'contextual_add',
        anchor_text: result.anchor,
        original_paragraph: sentencePara.text,
        modified_paragraph: result.modifiedParagraph,
        paragraph_index: sentencePara.index,
        relevance_score: sentencePara.score,
        status: 'suggested',
        is_silo_match: candidate.isSiloMatch || false,
      }
    }
  }

  return null
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

  if (content.includes(originalParagraph)) {
    content = content.replace(originalParagraph, modifiedParagraph)
  } else {
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

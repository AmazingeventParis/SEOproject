// ============================================================
// Cross-article phrase deduplication
// Detects overused expressions across articles from the same persona
// ============================================================

import { getServerClient } from '@/lib/supabase/client'

interface OverusedPhrase {
  phrase: string
  count: number
}

/**
 * Extract n-grams (3 to 6 words) from plain text.
 * Filters out very short/common fragments.
 */
function extractNgrams(text: string, minN = 3, maxN = 6): Map<string, number> {
  const ngrams = new Map<string, number>()

  // Normalize: lowercase, strip HTML, collapse whitespace
  const clean = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[.,;:!?()[\]{}""«»"'—–\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  const words = clean.split(' ').filter(w => w.length > 1)

  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(' ')
      // Skip grams that are mostly stop words
      if (isStopGram(gram)) continue
      ngrams.set(gram, (ngrams.get(gram) || 0) + 1)
    }
  }

  return ngrams
}

// Common French stop words to filter out meaningless n-grams
const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
  'et', 'ou', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'ce', 'ces',
  'est', 'sont', 'a', 'qui', 'que', 'ne', 'pas', 'il', 'elle', 'on',
  'nous', 'vous', 'ils', 'elles', 'se', 'sa', 'son', 'ses', 'leur',
  'leurs', 'mais', 'donc', 'car', 'si', 'plus', 'moins', 'tres', 'bien',
  'etre', 'avoir', 'faire', 'dire', 'tout', 'tous', 'cette', 'cet',
])

function isStopGram(gram: string): boolean {
  const words = gram.split(' ')
  const stopCount = words.filter(w => STOP_WORDS.has(w)).length
  // If more than 60% stop words, skip
  return stopCount / words.length > 0.6
}

/**
 * Detect overused phrases across recent articles from the same persona.
 * Returns phrases that appear in 2+ different articles (cross-article tics).
 *
 * @param personaId - The persona to analyze
 * @param excludeArticleId - Current article to exclude from analysis
 * @param limit - Max recent articles to scan (default 20)
 */
export async function detectOverusedPhrases(
  personaId: string,
  excludeArticleId?: string,
  limit = 20
): Promise<OverusedPhrase[]> {
  const supabase = getServerClient()

  // Fetch recent written articles from this persona
  const query = supabase
    .from('seo_articles')
    .select('id, content_blocks')
    .eq('persona_id', personaId)
    .not('content_blocks', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (excludeArticleId) {
    query.neq('id', excludeArticleId)
  }

  const { data: articles, error } = await query

  if (error || !articles || articles.length < 2) {
    // Need at least 2 articles to detect cross-article repetition
    return []
  }

  // Extract text per article and compute n-grams per article
  const articleNgrams: Map<string, Set<string>>[] = []

  for (const article of articles) {
    const blocks = article.content_blocks as { content_html?: string }[] | null
    if (!blocks) continue

    const fullText = blocks
      .map(b => b.content_html || '')
      .join(' ')

    if (fullText.length < 100) continue

    const ngrams = extractNgrams(fullText)
    const articleGrams = new Map<string, Set<string>>()

    // Track which n-grams appear in this article
    for (const [gram] of ngrams) {
      if (!articleGrams.has(gram)) {
        articleGrams.set(gram, new Set())
      }
      articleGrams.get(gram)!.add(article.id)
    }

    articleNgrams.push(articleGrams)
  }

  // Merge: count how many different articles each n-gram appears in
  const globalCounts = new Map<string, Set<string>>()

  for (const articleMap of articleNgrams) {
    for (const [gram, articleIds] of articleMap) {
      if (!globalCounts.has(gram)) {
        globalCounts.set(gram, new Set())
      }
      for (const id of articleIds) {
        globalCounts.get(gram)!.add(id)
      }
    }
  }

  // Filter: keep phrases appearing in 3+ articles (real tics, not coincidence)
  const minArticles = Math.min(3, Math.ceil(articles.length * 0.3))
  const overused: OverusedPhrase[] = []

  for (const [gram, articleIds] of globalCounts) {
    if (articleIds.size >= minArticles) {
      overused.push({ phrase: gram, count: articleIds.size })
    }
  }

  // Sort by frequency (most overused first), limit to top 20
  overused.sort((a, b) => b.count - a.count)

  // Deduplicate: if a longer phrase contains a shorter one with same count, keep the longer
  const deduplicated: OverusedPhrase[] = []
  for (const item of overused) {
    const isSubset = deduplicated.some(
      existing =>
        existing.count >= item.count &&
        existing.phrase.includes(item.phrase)
    )
    if (!isSubset) {
      deduplicated.push(item)
    }
  }

  return deduplicated.slice(0, 20)
}

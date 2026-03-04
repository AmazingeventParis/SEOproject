// ============================================================
// Keyword analysis utilities
// French-focused intent classification and keyword variation extraction
// ============================================================

// ---- Keyword variation extraction ----

/**
 * Extract keyword variations from SERP data (related searches + PAA questions).
 *
 * @param mainKeyword  The primary keyword
 * @param serpData     SERP data containing related searches and PAA
 * @returns            Deduplicated list of keyword variations
 */
export function extractKeywordVariations(
  mainKeyword: string,
  serpData: {
    relatedSearches: { query: string }[]
    peopleAlsoAsk: { question: string }[]
  }
): string[] {
  const mainKwLower = mainKeyword.toLowerCase().trim()
  const variations = new Set<string>()

  // Add related searches
  for (const r of serpData.relatedSearches) {
    const query = r.query.trim()
    if (query && query.toLowerCase() !== mainKwLower) {
      variations.add(query)
    }
  }

  // Add PAA questions
  for (const p of serpData.peopleAlsoAsk) {
    const question = p.question.trim()
    if (question && question.toLowerCase() !== mainKwLower) {
      variations.add(question)
    }
  }

  return Array.from(variations)
}

// ---- Slug generation ----

/**
 * Generate a URL-friendly slug from a French keyword or title.
 * Handles accented characters, special chars, and common French articles.
 *
 * @param text  The text to slugify
 * @returns     A clean URL slug
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Replace accented characters
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Replace special characters with hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Collapse multiple hyphens
    .replace(/-{2,}/g, '-')
}

// ---- Keyword density analysis ----

export interface KeywordDensity {
  keyword: string
  count: number
  density: number
  status: 'too_low' | 'optimal' | 'too_high'
}

/**
 * Analyze keyword density in a block of text/HTML.
 *
 * @param content        The text content (HTML tags will be stripped)
 * @param targetKeyword  The keyword to check density for
 * @returns              Density analysis with status
 */
export function analyzeKeywordDensity(
  content: string,
  targetKeyword: string
): KeywordDensity {
  // Strip HTML tags
  const plainText = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = plainText.split(/\s+/)
  const totalWords = words.length

  if (totalWords === 0) {
    return { keyword: targetKeyword, count: 0, density: 0, status: 'too_low' }
  }

  // Count keyword occurrences (case-insensitive, word boundary)
  const kwLower = targetKeyword.toLowerCase()
  const textLower = plainText.toLowerCase()

  // Count exact phrase occurrences
  let count = 0
  let searchPos = 0
  while (true) {
    const idx = textLower.indexOf(kwLower, searchPos)
    if (idx === -1) break
    count++
    searchPos = idx + kwLower.length
  }

  // Density as percentage of total words
  const kwWordCount = targetKeyword.split(/\s+/).length
  const density = totalWords > 0 ? (count * kwWordCount * 100) / totalWords : 0

  // Optimal density: 0.5% - 2.5% for primary keyword
  let status: 'too_low' | 'optimal' | 'too_high'
  if (density < 0.5) {
    status = 'too_low'
  } else if (density > 2.5) {
    status = 'too_high'
  } else {
    status = 'optimal'
  }

  return {
    keyword: targetKeyword,
    count,
    density: Math.round(density * 100) / 100,
    status,
  }
}

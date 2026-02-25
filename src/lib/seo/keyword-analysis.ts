// ============================================================
// Keyword analysis utilities
// French-focused intent classification and keyword variation extraction
// ============================================================

// ---- Intent classification ----

export type KeywordIntent =
  | 'informational'
  | 'transactional'
  | 'navigational'
  | 'commercial'

/**
 * Classify the search intent of a keyword.
 * Primarily designed for French keywords, with English fallback support.
 *
 * @param keyword  The keyword to classify
 * @returns        The detected search intent
 */
export function classifyIntent(keyword: string): KeywordIntent {
  const kw = keyword.toLowerCase().trim()

  // Transactional: user wants to buy or take action
  if (
    /\b(acheter|commander|prix|tarif|pas cher|promo|promotion|reduction|offre|solde|devis|reservation|reserver|souscrire|abonnement|achat|livraison|gratuit|telecharger|download|buy|order|discount|deal|coupon)\b/.test(
      kw
    )
  ) {
    return 'transactional'
  }

  // Commercial investigation: user compares options before deciding
  if (
    /\b(avis|comparatif|comparaison|meilleur|meilleure|meilleurs|meilleures|vs|versus|test|classement|top|selection|alternative|alternatives|quel|quelle|quels|quelles|choisir|review|best|ranking)\b/.test(
      kw
    )
  ) {
    return 'commercial'
  }

  // Navigational: user looking for a specific site/brand
  if (
    /\b(login|connexion|mon compte|site officiel|espace client|espace personnel|app|application|contact|support|service client|adresse|horaire|telephone)\b/.test(
      kw
    )
  ) {
    return 'navigational'
  }

  // Informational: user wants to learn
  if (
    /\b(comment|pourquoi|quand|combien|ou|qu.?est.?ce|definition|signification|c.?est quoi|explication|tutoriel|tuto|guide|astuce|astuces|conseil|conseils|etape|etapes|methode|technique|apprendre|comprendre|difference|fonctionnement|how|what|why|when|where|tutorial|tips)\b/.test(
      kw
    )
  ) {
    return 'informational'
  }

  // Default: most searches are informational
  return 'informational'
}

/**
 * Get a human-readable French label for a search intent.
 */
export function getIntentLabel(intent: KeywordIntent): string {
  const labels: Record<KeywordIntent, string> = {
    informational: 'Informationnel',
    transactional: 'Transactionnel',
    navigational: 'Navigationnel',
    commercial: 'Commercial / Investigation',
  }
  return labels[intent]
}

/**
 * Get the typical content type expected for a given intent.
 */
export function getExpectedContentType(intent: KeywordIntent): string {
  const types: Record<KeywordIntent, string> = {
    informational: 'Article de blog / Guide / Tutoriel',
    transactional: 'Page produit / Landing page',
    navigational: 'Page de marque / Page contact',
    commercial: 'Comparatif / Test / Avis',
  }
  return types[intent]
}

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

// ---- Keyword quality scoring ----

export interface KeywordScore {
  keyword: string
  intent: KeywordIntent
  lengthScore: number
  intentScore: number
  totalScore: number
  suggestion: string
}

/**
 * Score a keyword for content creation suitability.
 * Higher score = better keyword to write an article about.
 *
 * @param keyword  The keyword to score
 * @returns        Score breakdown with suggestions
 */
export function scoreKeyword(keyword: string): KeywordScore {
  const words = keyword.trim().split(/\s+/)
  const intent = classifyIntent(keyword)

  // Length score: 2-5 words is ideal for long-tail targeting
  let lengthScore: number
  if (words.length === 1) {
    lengthScore = 30 // Too broad, hard to rank
  } else if (words.length === 2) {
    lengthScore = 60
  } else if (words.length >= 3 && words.length <= 5) {
    lengthScore = 100 // Sweet spot
  } else if (words.length <= 7) {
    lengthScore = 80
  } else {
    lengthScore = 50 // Too long, low search volume
  }

  // Intent score: informational and commercial intents are best for blog articles
  const intentScores: Record<KeywordIntent, number> = {
    informational: 100,
    commercial: 90,
    transactional: 60,
    navigational: 30,
  }
  const intentScore = intentScores[intent]

  // Total score
  const totalScore = Math.round((lengthScore * 0.4 + intentScore * 0.6))

  // Build suggestion
  let suggestion: string
  if (totalScore >= 80) {
    suggestion = 'Excellent mot-cle pour un article SEO.'
  } else if (totalScore >= 60) {
    suggestion = 'Bon mot-cle. '
    if (lengthScore < 60)
      suggestion += 'Envisagez une variante plus longue (long-tail) pour mieux cibler.'
    if (intentScore < 60)
      suggestion += 'L\'intention de recherche est plus transactionnelle - adaptez le format.'
  } else {
    suggestion = 'Mot-cle peu adapte pour un article de blog. '
    if (intent === 'navigational')
      suggestion += 'Intention navigationnelle detectee - ciblez plutot une page dediee.'
    if (words.length === 1)
      suggestion += 'Trop generique - ajoutez des qualificatifs pour cibler une niche.'
  }

  return {
    keyword: keyword.trim(),
    intent,
    lengthScore,
    intentScore,
    totalScore,
    suggestion,
  }
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

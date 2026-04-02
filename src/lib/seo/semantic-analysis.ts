// ============================================================
// Semantic SEO Analysis
// Post-write semantic validation: TF-IDF coverage, entity extraction,
// semantic scoring, missing term detection, cannibalization detection
// ============================================================

import { tokenize, type TermScore } from './competitor-scraper'

// ---- Types ----

export interface SemanticCoverageResult {
  /** Score 0-100: % of TF-IDF terms found in article */
  tfidfCoverage: number
  /** Score 0-100: % of semantic field terms found */
  semanticFieldCoverage: number
  /** Combined weighted score (60% TF-IDF + 40% semantic field) */
  globalScore: number
  /** TF-IDF terms present in the article */
  tfidfPresent: string[]
  /** TF-IDF terms missing from the article */
  tfidfMissing: string[]
  /** Semantic field terms present */
  semanticPresent: string[]
  /** Semantic field terms missing */
  semanticMissing: string[]
  /** Per-block analysis: which blocks cover which terms */
  blockCoverage: BlockSemanticCoverage[]
}

export interface BlockSemanticCoverage {
  blockIndex: number
  heading: string | null
  /** Semantic terms found in this specific block */
  termsFound: string[]
}

export interface EntityExtractionResult {
  /** Entities found in competitor content */
  competitorEntities: ExtractedEntity[]
  /** Entities present in our article */
  entitiesPresent: string[]
  /** Entities missing from our article */
  entitiesMissing: string[]
  /** Coverage score 0-100 */
  coverageScore: number
}

export interface ExtractedEntity {
  name: string
  type: 'person' | 'brand' | 'concept' | 'place' | 'organization' | 'metric' | 'tool' | 'other'
  frequency: number // how many competitor pages mention it
}

export interface SemanticCannibalizationResult {
  /** Article pairs with high semantic overlap */
  conflicts: SemanticConflict[]
  /** Whether any conflict exceeds the threshold */
  hasConflict: boolean
}

export interface SemanticConflict {
  articleId: string
  articleTitle: string
  articleKeyword: string
  /** Percentage of shared TF-IDF terms */
  overlapScore: number
  /** The shared terms */
  sharedTerms: string[]
}

export interface MissingTermSuggestion {
  term: string
  importance: 'high' | 'medium' | 'low'
  /** Suggested block index to inject the term */
  suggestedBlockIndex: number
  /** Reason for the suggestion */
  reason: string
}

// ---- Core functions ----

/**
 * Normalize text for semantic comparison:
 * - Strip HTML, lowercase, remove accents, tokenize
 */
function normalizeForSemantic(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Check if a term (possibly multi-word) appears in normalized text.
 * For single words: exact token match.
 * For multi-word terms: substring match.
 */
function termExistsInText(term: string, normalizedText: string): boolean {
  const normalizedTerm = term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  // Direct substring match (handles multi-word terms)
  if (normalizedText.includes(normalizedTerm)) return true

  // For single-word terms, also check with word boundaries
  if (!normalizedTerm.includes(' ')) {
    // Check if the term appears as a distinct word (not part of another word)
    const regex = new RegExp(`\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return regex.test(normalizedText)
  }

  return false
}

/**
 * Axe 1 + 3: Validate semantic coverage of written content against
 * TF-IDF keywords and semantic field from competitor analysis.
 *
 * @param contentBlocks  The article's content blocks
 * @param tfidfKeywords  TF-IDF terms from competitor analysis (stored in serp_data.competitorContent.tfidfKeywords)
 * @param semanticField  Semantic field terms from Gemini analysis (stored in serp_data.semanticAnalysis.semanticField)
 * @returns              Detailed coverage analysis
 */
export function analyzeSemanticCoverage(
  contentBlocks: { content_html: string; heading?: string | null; type: string; status?: string }[],
  tfidfKeywords: TermScore[],
  semanticField: string[],
): SemanticCoverageResult {
  // Build full article text
  const writtenBlocks = contentBlocks.filter(b => b.content_html && b.status !== 'pending')
  const fullText = normalizeForSemantic(
    writtenBlocks.map(b => `${b.heading || ''} ${b.content_html}`).join(' ')
  )

  // Check TF-IDF terms (top 30 most important)
  const tfidfToCheck = tfidfKeywords.slice(0, 30)
  const tfidfPresent: string[] = []
  const tfidfMissing: string[] = []

  for (const term of tfidfToCheck) {
    if (termExistsInText(term.term, fullText)) {
      tfidfPresent.push(term.term)
    } else {
      tfidfMissing.push(term.term)
    }
  }

  // Check semantic field terms
  const semanticPresent: string[] = []
  const semanticMissing: string[] = []

  for (const term of semanticField) {
    if (termExistsInText(term, fullText)) {
      semanticPresent.push(term)
    } else {
      semanticMissing.push(term)
    }
  }

  // Per-block coverage analysis
  const blockCoverage: BlockSemanticCoverage[] = writtenBlocks.map((block, idx) => {
    const blockText = normalizeForSemantic(`${block.heading || ''} ${block.content_html}`)
    const allTerms = [...tfidfToCheck.map(t => t.term), ...semanticField]
    const termsFound = allTerms.filter(t => termExistsInText(t, blockText))

    // Find original block index
    const originalIdx = contentBlocks.indexOf(block as typeof contentBlocks[0])

    return {
      blockIndex: originalIdx >= 0 ? originalIdx : idx,
      heading: block.heading || null,
      termsFound: Array.from(new Set(termsFound)),
    }
  })

  // Calculate scores
  const tfidfCoverage = tfidfToCheck.length > 0
    ? Math.round((tfidfPresent.length / tfidfToCheck.length) * 100)
    : 100
  const semanticFieldCoverage = semanticField.length > 0
    ? Math.round((semanticPresent.length / semanticField.length) * 100)
    : 100

  // Weighted global score: 60% TF-IDF + 40% semantic field
  const globalScore = Math.round(tfidfCoverage * 0.6 + semanticFieldCoverage * 0.4)

  return {
    tfidfCoverage,
    semanticFieldCoverage,
    globalScore,
    tfidfPresent,
    tfidfMissing,
    semanticPresent,
    semanticMissing,
    blockCoverage,
  }
}

/**
 * Axe 4: Generate suggestions for missing terms with recommended injection points.
 *
 * @param coverage       Result from analyzeSemanticCoverage
 * @param tfidfKeywords  Original TF-IDF terms with scores (for importance ranking)
 * @param contentBlocks  The article's content blocks (for finding best injection points)
 * @returns              List of actionable suggestions
 */
export function generateMissingTermSuggestions(
  coverage: SemanticCoverageResult,
  tfidfKeywords: TermScore[],
  contentBlocks: { content_html: string; heading?: string | null; type: string; status?: string }[],
): MissingTermSuggestion[] {
  const suggestions: MissingTermSuggestion[] = []
  const tfidfMap = new Map(tfidfKeywords.map(t => [t.term, t]))

  // Process TF-IDF missing terms
  for (const term of coverage.tfidfMissing) {
    const termData = tfidfMap.get(term)
    const importance = termData && termData.df >= 3 ? 'high'
      : termData && termData.df >= 2 ? 'medium'
      : 'low'

    // Find best block to inject: the one with the most related terms already
    const bestBlock = findBestBlockForTerm(term, coverage.blockCoverage, contentBlocks)

    suggestions.push({
      term,
      importance,
      suggestedBlockIndex: bestBlock,
      reason: `Terme TF-IDF present chez ${termData?.df || '?'}/${tfidfKeywords.length > 0 ? 'N' : '0'} concurrents`,
    })
  }

  // Process semantic field missing terms
  for (const term of coverage.semanticMissing) {
    // Check if already added from TF-IDF
    if (suggestions.some(s => s.term === term)) continue

    const bestBlock = findBestBlockForTerm(term, coverage.blockCoverage, contentBlocks)

    suggestions.push({
      term,
      importance: 'medium',
      suggestedBlockIndex: bestBlock,
      reason: 'Terme du champ semantique absent',
    })
  }

  // Sort by importance: high > medium > low
  const importanceOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => importanceOrder[a.importance] - importanceOrder[b.importance])

  return suggestions
}

/**
 * Find the best block to inject a missing term.
 * Strategy: pick the block that already covers the most related terms
 * (semantic proximity), preferring H2 blocks over others.
 */
function findBestBlockForTerm(
  term: string,
  blockCoverage: BlockSemanticCoverage[],
  contentBlocks: { type: string; status?: string }[],
): number {
  if (blockCoverage.length === 0) return 0

  // Score each block: number of terms already present (semantic neighborhood)
  // + bonus for H2 blocks (more impactful for SEO)
  let bestIdx = 0
  let bestScore = -1

  for (const bc of blockCoverage) {
    const block = contentBlocks[bc.blockIndex]
    if (!block || block.status === 'pending') continue

    let score = bc.termsFound.length
    if (block.type === 'h2') score += 2  // prefer H2 blocks
    if (block.type === 'paragraph' && bc.blockIndex === 0) score += 1 // intro is good too

    if (score > bestScore) {
      bestScore = score
      bestIdx = bc.blockIndex
    }
  }

  return bestIdx
}

/**
 * Axe 5: Detect semantic cannibalization between articles in the same silo.
 * Compares TF-IDF term overlap between the current article and other articles.
 *
 * @param currentArticleTerms  Tokenized terms from the current article
 * @param otherArticles        Other articles in the same silo with their serp_data
 * @param threshold            Overlap threshold to flag as conflict (default 60%)
 * @returns                    Cannibalization analysis
 */
export function detectSemanticCannibalization(
  currentArticleTerms: Set<string>,
  otherArticles: {
    id: string
    title: string | null
    keyword: string
    serp_data: Record<string, unknown> | null
    content_blocks: { content_html: string; heading?: string | null; status?: string }[] | null
  }[],
  threshold: number = 60,
): SemanticCannibalizationResult {
  const conflicts: SemanticConflict[] = []

  for (const other of otherArticles) {
    // Get the other article's TF-IDF terms from serp_data
    const otherSerpData = other.serp_data || {}
    const otherCompetitorContent = otherSerpData.competitorContent as { tfidfKeywords?: TermScore[] } | undefined
    const otherTfidf = otherCompetitorContent?.tfidfKeywords || []

    // Also tokenize other article's actual content for comparison
    let otherTerms: Set<string>

    if (other.content_blocks && other.content_blocks.length > 0) {
      const otherText = other.content_blocks
        .filter(b => b.content_html && b.status !== 'pending')
        .map(b => `${b.heading || ''} ${b.content_html}`)
        .join(' ')
      otherTerms = new Set(tokenize(normalizeForSemantic(otherText)))
    } else if (otherTfidf.length > 0) {
      // Fallback: use TF-IDF terms as proxy
      otherTerms = new Set(otherTfidf.map(t => t.term))
    } else {
      continue // No data to compare
    }

    // Calculate overlap
    const sharedTerms: string[] = []
    Array.from(currentArticleTerms).forEach(term => {
      if (otherTerms.has(term)) {
        sharedTerms.push(term)
      }
    })

    // Overlap = shared / min(current, other) — Jaccard-like but using smaller set
    const minSize = Math.min(currentArticleTerms.size, otherTerms.size)
    if (minSize === 0) continue

    const overlapScore = Math.round((sharedTerms.length / minSize) * 100)

    if (overlapScore >= threshold) {
      conflicts.push({
        articleId: other.id,
        articleTitle: other.title || other.keyword,
        articleKeyword: other.keyword,
        overlapScore,
        sharedTerms: sharedTerms.slice(0, 20), // cap at 20 for readability
      })
    }
  }

  // Sort by overlap score descending
  conflicts.sort((a, b) => b.overlapScore - a.overlapScore)

  return {
    conflicts,
    hasConflict: conflicts.length > 0,
  }
}

/**
 * Axe 2: Build a prompt for NLP entity extraction from competitor content.
 * Used during executeAnalyze to extract entities via Gemini.
 */
export function buildEntityExtractionPrompt(
  keyword: string,
  competitorTexts: string[],
): string {
  // Concatenate competitor texts, capped at 15K chars
  const combined = competitorTexts
    .map((t, i) => `--- Page ${i + 1} ---\n${t.slice(0, 3000)}`)
    .join('\n\n')
    .slice(0, 15000)

  return `Tu es un expert en NLP et SEO semantique.

## MOT-CLE : "${keyword}"

## CONTENU DES CONCURRENTS
${combined}

## MISSION
Extrais les ENTITES NOMMEES importantes mentionnees par les concurrents.
Ce sont les personnes, marques, outils, concepts, lieux, organisations et metriques qui composent l'univers semantique de ce sujet.

Google utilise ces entites pour comprendre la profondeur et l'expertise d'un article (Knowledge Graph, E-E-A-T).

Retourne UNIQUEMENT un JSON valide :
{
  "entities": [
    { "name": "Nom de l'entite", "type": "person|brand|concept|place|organization|metric|tool|other", "frequency": 3 }
  ]
}

Regles :
- 15-40 entites maximum
- frequency = nombre de pages concurrentes qui mentionnent cette entite (1-${competitorTexts.length})
- Trie par frequency decroissante puis par importance SEO
- Inclus UNIQUEMENT les entites specifiques au domaine (pas les termes generiques)
- Types : person (expert, auteur), brand (marque, produit), concept (technique, methode), place (lieu, pays), organization (entreprise, institution), metric (chiffre, KPI, stat), tool (outil, logiciel)
- Ne duplique pas les entites presentes dans le mot-cle principal`
}

/**
 * Validate entity extraction from competitor content against article content.
 */
export function validateEntityCoverage(
  entities: ExtractedEntity[],
  contentBlocks: { content_html: string; heading?: string | null; status?: string }[],
): EntityExtractionResult {
  const fullText = normalizeForSemantic(
    contentBlocks
      .filter(b => b.content_html && b.status !== 'pending')
      .map(b => `${b.heading || ''} ${b.content_html}`)
      .join(' ')
  )

  const entitiesPresent: string[] = []
  const entitiesMissing: string[] = []

  for (const entity of entities) {
    if (termExistsInText(entity.name, fullText)) {
      entitiesPresent.push(entity.name)
    } else {
      entitiesMissing.push(entity.name)
    }
  }

  const coverageScore = entities.length > 0
    ? Math.round((entitiesPresent.length / entities.length) * 100)
    : 100

  return {
    competitorEntities: entities,
    entitiesPresent,
    entitiesMissing,
    coverageScore,
  }
}

/**
 * Tokenize article content into a term set for cannibalization comparison.
 */
export function tokenizeArticleContent(
  contentBlocks: { content_html: string; heading?: string | null; status?: string }[],
): Set<string> {
  const text = contentBlocks
    .filter(b => b.content_html && b.status !== 'pending')
    .map(b => `${b.heading || ''} ${b.content_html}`)
    .join(' ')

  return new Set(tokenize(normalizeForSemantic(text)))
}

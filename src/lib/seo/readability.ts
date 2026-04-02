// ============================================================
// Readability Scoring
// Algorithmic readability analysis for French content
// Computes sentence length, paragraph density, visual element ratio,
// and produces a 0-100 readability score
// ============================================================

export interface ReadabilityResult {
  /** Global readability score 0-100 */
  score: number
  /** Average words per sentence */
  avgSentenceLength: number
  /** Percentage of sentences > 25 words */
  longSentenceRatio: number
  /** Average words per paragraph */
  avgParagraphLength: number
  /** Total number of sentences */
  totalSentences: number
  /** Total number of paragraphs */
  totalParagraphs: number
  /** Number of visual elements (lists, tables, blockquotes, callouts) */
  visualElements: number
  /** Ratio of visual elements to total blocks */
  visualDensity: number
  /** Number of consecutive paragraph blocks without visual break */
  maxConsecutiveProse: number
  /** Issues detected */
  issues: string[]
}

/**
 * Compute a readability score for HTML content.
 * Adapted for French: shorter sentences = better, more visual elements = better.
 *
 * Scoring breakdown (100 points max):
 * - Sentence length (0-30): avg < 20 words = 30, 20-25 = 20, 25-30 = 10, >30 = 0
 * - Long sentence ratio (0-20): < 15% = 20, 15-25% = 15, 25-35% = 10, >35% = 0
 * - Paragraph length (0-15): avg < 60 words = 15, 60-80 = 10, 80-100 = 5, >100 = 0
 * - Visual density (0-20): >= 1 visual per 2 blocks = 20, per 3 = 15, per 4 = 10, else = 5
 * - Consecutive prose (0-15): max 2 = 15, 3 = 10, 4 = 5, >4 = 0
 */
export function analyzeReadability(
  contentBlocks: { content_html: string; type: string; heading?: string | null; status?: string }[],
): ReadabilityResult {
  const writtenBlocks = contentBlocks.filter(b => b.content_html && b.status !== 'pending' && b.type !== 'image')
  const issues: string[] = []

  if (writtenBlocks.length === 0) {
    return {
      score: 0, avgSentenceLength: 0, longSentenceRatio: 0, avgParagraphLength: 0,
      totalSentences: 0, totalParagraphs: 0, visualElements: 0, visualDensity: 0,
      maxConsecutiveProse: 0, issues: ['Aucun contenu a analyser'],
    }
  }

  // Extract all text content
  const fullHtml = writtenBlocks.map(b => b.content_html).join('\n')
  const plainText = fullHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  // 1. Sentence analysis
  // Split on sentence-ending punctuation followed by space or end
  const sentences = plainText
    .split(/[.!?]+(?:\s|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 10) // filter out fragments

  const totalSentences = sentences.length
  const sentenceLengths = sentences.map(s => s.split(/\s+/).length)
  const avgSentenceLength = totalSentences > 0
    ? Math.round(sentenceLengths.reduce((a, b) => a + b, 0) / totalSentences * 10) / 10
    : 0

  const longSentences = sentenceLengths.filter(l => l > 25).length
  const longSentenceRatio = totalSentences > 0
    ? Math.round((longSentences / totalSentences) * 100)
    : 0

  // 2. Paragraph analysis
  const paragraphMatches = fullHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []
  const totalParagraphs = paragraphMatches.length
  const paragraphLengths = paragraphMatches.map(p => {
    const text = p.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return text.split(/\s+/).length
  })
  const avgParagraphLength = totalParagraphs > 0
    ? Math.round(paragraphLengths.reduce((a, b) => a + b, 0) / totalParagraphs)
    : 0

  // 3. Visual elements count (lists, tables, blockquotes, callouts, details/FAQ)
  const listCount = (fullHtml.match(/<(?:ul|ol)[\s>]/gi) || []).length
  const tableCount = (fullHtml.match(/<table[\s>]/gi) || []).length
  const blockquoteCount = (fullHtml.match(/<blockquote[\s>]/gi) || []).length
  const calloutCount = (fullHtml.match(/class="callout/gi) || []).length
  const detailsCount = (fullHtml.match(/<details[\s>]/gi) || []).length
  const visualElements = listCount + tableCount + blockquoteCount + calloutCount + detailsCount

  const visualDensity = writtenBlocks.length > 0
    ? Math.round((visualElements / writtenBlocks.length) * 100) / 100
    : 0

  // 4. Consecutive prose blocks (paragraphs without visual breaks)
  let maxConsecutiveProse = 0
  let currentConsecutive = 0

  for (const block of writtenBlocks) {
    const html = block.content_html
    const hasVisual = /<(?:ul|ol|table|blockquote|details)[\s>]/i.test(html)
      || /class="callout/i.test(html)

    if (hasVisual || block.type === 'faq' || block.type === 'list') {
      currentConsecutive = 0
    } else {
      currentConsecutive++
      if (currentConsecutive > maxConsecutiveProse) {
        maxConsecutiveProse = currentConsecutive
      }
    }
  }

  // 5. Compute score
  // Sentence length score (0-30)
  let sentenceScore: number
  if (avgSentenceLength <= 18) sentenceScore = 30
  else if (avgSentenceLength <= 22) sentenceScore = 25
  else if (avgSentenceLength <= 25) sentenceScore = 20
  else if (avgSentenceLength <= 30) sentenceScore = 10
  else sentenceScore = 0

  // Long sentence ratio score (0-20)
  let longSentenceScore: number
  if (longSentenceRatio <= 15) longSentenceScore = 20
  else if (longSentenceRatio <= 25) longSentenceScore = 15
  else if (longSentenceRatio <= 35) longSentenceScore = 10
  else longSentenceScore = 0

  // Paragraph length score (0-15)
  let paragraphScore: number
  if (avgParagraphLength <= 60) paragraphScore = 15
  else if (avgParagraphLength <= 80) paragraphScore = 10
  else if (avgParagraphLength <= 100) paragraphScore = 5
  else paragraphScore = 0

  // Visual density score (0-20)
  let visualScore: number
  if (visualDensity >= 0.5) visualScore = 20      // 1 visual per 2 blocks
  else if (visualDensity >= 0.33) visualScore = 15  // 1 per 3
  else if (visualDensity >= 0.25) visualScore = 10  // 1 per 4
  else visualScore = 5

  // Consecutive prose score (0-15)
  let proseScore: number
  if (maxConsecutiveProse <= 2) proseScore = 15
  else if (maxConsecutiveProse <= 3) proseScore = 10
  else if (maxConsecutiveProse <= 4) proseScore = 5
  else proseScore = 0

  const score = sentenceScore + longSentenceScore + paragraphScore + visualScore + proseScore

  // 6. Generate issues
  if (avgSentenceLength > 25) {
    issues.push(`Phrases trop longues (moy. ${avgSentenceLength} mots) — visez < 20 mots`)
  }
  if (longSentenceRatio > 30) {
    issues.push(`${longSentenceRatio}% de phrases > 25 mots — decoupez les phrases longues`)
  }
  if (avgParagraphLength > 80) {
    issues.push(`Paragraphes trop denses (moy. ${avgParagraphLength} mots) — decoupez en paragraphes plus courts`)
  }
  if (maxConsecutiveProse > 3) {
    issues.push(`${maxConsecutiveProse} blocs consecutifs sans element visuel — ajoutez une liste ou un tableau`)
  }
  if (visualDensity < 0.25) {
    issues.push(`Seulement ${visualElements} elements visuels pour ${writtenBlocks.length} blocs — enrichissez avec des listes/tableaux`)
  }

  return {
    score,
    avgSentenceLength,
    longSentenceRatio,
    avgParagraphLength,
    totalSentences,
    totalParagraphs,
    visualElements,
    visualDensity,
    maxConsecutiveProse,
    issues,
  }
}

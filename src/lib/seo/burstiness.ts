// ============================================================
// Burstiness & AI Detection Scoring
// Measures sentence length variance (burstiness), connector overuse,
// and other AI fingerprints to flag robotic content
// ============================================================

export interface BurstinessResult {
  /** Global burstiness score 0-100 (100 = very human-like variation) */
  score: number
  /** Standard deviation of sentence lengths */
  sentenceLengthStdDev: number
  /** Average sentence length */
  avgSentenceLength: number
  /** Min sentence length (words) */
  minSentenceLength: number
  /** Max sentence length (words) */
  maxSentenceLength: number
  /** Ratio of very short sentences (<6 words) — humans use more of these */
  shortSentenceRatio: number
  /** Ratio of long sentences (>25 words) */
  longSentenceRatio: number
  /** Number of overused connectors (same connector 3+ times) */
  overusedConnectors: { connector: string; count: number }[]
  /** Issues detected */
  issues: string[]
}

// Common French connectors that AI overuses
const FORMAL_CONNECTORS = [
  'en effet', 'par ailleurs', 'de plus', 'en outre', 'neanmoins',
  'toutefois', 'cependant', 'par consequent', 'en revanche', 'ainsi',
  'de ce fait', 'il est essentiel', 'il est important', 'il faut noter',
  'a cet egard', 'd\'autre part', 'd\'autant plus', 'en somme',
  'qui plus est', 'force est de constater', 'il convient de',
  'dans cette optique', 'a ce titre', 'en l\'occurrence',
  'il va sans dire', 'en definitive', 'dans cette perspective',
]

/**
 * Analyze burstiness (sentence length variation) of written content.
 * Low burstiness = robotic (AI). High burstiness = human-like.
 */
export function analyzeBurstiness(
  contentBlocks: { content_html: string; type: string; status?: string }[],
): BurstinessResult {
  const issues: string[] = []
  const writtenBlocks = contentBlocks.filter(
    b => b.content_html && b.status !== 'pending' && b.type !== 'image'
  )

  if (writtenBlocks.length === 0) {
    return {
      score: 0, sentenceLengthStdDev: 0, avgSentenceLength: 0,
      minSentenceLength: 0, maxSentenceLength: 0,
      shortSentenceRatio: 0, longSentenceRatio: 0,
      overusedConnectors: [], issues: ['Aucun contenu a analyser'],
    }
  }

  const fullHtml = writtenBlocks.map(b => b.content_html).join('\n')
  const plainText = fullHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Split into sentences (French punctuation)
  const sentences = plainText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5)

  if (sentences.length < 5) {
    return {
      score: 50, sentenceLengthStdDev: 0, avgSentenceLength: 0,
      minSentenceLength: 0, maxSentenceLength: 0,
      shortSentenceRatio: 0, longSentenceRatio: 0,
      overusedConnectors: [], issues: ['Pas assez de phrases pour analyser la burstiness'],
    }
  }

  // Calculate sentence lengths
  const lengths = sentences.map(s => s.split(/\s+/).length)
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length
  const stdDev = Math.sqrt(variance)
  const minLen = Math.min(...lengths)
  const maxLen = Math.max(...lengths)

  const shortCount = lengths.filter(l => l <= 5).length
  const longCount = lengths.filter(l => l > 25).length
  const shortRatio = shortCount / lengths.length
  const longRatio = longCount / lengths.length

  // Score burstiness (sentence length variation)
  // AI typically has stdDev of 3-5, humans have 6-12+
  let burstinessScore = 0
  if (stdDev >= 10) burstinessScore = 40
  else if (stdDev >= 7) burstinessScore = 35
  else if (stdDev >= 5) burstinessScore = 25
  else if (stdDev >= 3) burstinessScore = 15
  else burstinessScore = 5

  // Score short sentence usage (humans use more punchy short sentences)
  // AI rarely writes sentences under 6 words
  if (shortRatio >= 0.15) burstinessScore += 20
  else if (shortRatio >= 0.10) burstinessScore += 15
  else if (shortRatio >= 0.05) burstinessScore += 10
  else burstinessScore += 0

  // Score range (max - min). Humans have wider range
  const range = maxLen - minLen
  if (range >= 25) burstinessScore += 15
  else if (range >= 18) burstinessScore += 12
  else if (range >= 12) burstinessScore += 8
  else burstinessScore += 3

  // Connector analysis
  const plainLower = plainText.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents for matching
  const overusedConnectors: { connector: string; count: number }[] = []

  for (const connector of FORMAL_CONNECTORS) {
    const normalized = connector.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const regex = new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const matches = plainLower.match(regex)
    const count = matches ? matches.length : 0
    if (count >= 3) {
      overusedConnectors.push({ connector, count })
    }
  }

  // Score connector variety (fewer overused = more human)
  if (overusedConnectors.length === 0) burstinessScore += 25
  else if (overusedConnectors.length <= 2) burstinessScore += 15
  else if (overusedConnectors.length <= 4) burstinessScore += 8
  else burstinessScore += 0

  // Cap at 100
  burstinessScore = Math.min(100, burstinessScore)

  // Generate issues
  if (stdDev < 4) {
    issues.push(`Variation de longueur de phrases trop faible (ecart-type: ${stdDev.toFixed(1)}) — signature IA typique. Alterner phrases courtes (3-5 mots) et longues (20+ mots).`)
  }
  if (shortRatio < 0.05) {
    issues.push(`Quasi aucune phrase courte (<6 mots) detectee (${(shortRatio * 100).toFixed(0)}%). Un humain en utilise 10-20%. Ajouter des phrases-choc courtes.`)
  }
  if (overusedConnectors.length > 0) {
    const top3 = overusedConnectors.slice(0, 3).map(c => `"${c.connector}" (${c.count}x)`)
    issues.push(`Connecteurs surexploites : ${top3.join(', ')}. Varier ou supprimer.`)
  }
  if (range < 12) {
    issues.push(`Amplitude de longueur trop faible (${minLen}-${maxLen} mots). Un humain alterne 2-30+ mots par phrase.`)
  }

  return {
    score: burstinessScore,
    sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
    avgSentenceLength: Math.round(avg * 10) / 10,
    minSentenceLength: minLen,
    maxSentenceLength: maxLen,
    shortSentenceRatio: Math.round(shortRatio * 100) / 100,
    longSentenceRatio: Math.round(longRatio * 100) / 100,
    overusedConnectors,
    issues,
  }
}

/**
 * Extract connectors already used in previously written blocks.
 * Returns a list of connectors that should NOT be reused (already used 2+ times).
 */
export function extractUsedConnectors(
  contentBlocks: { content_html: string; status?: string; type: string }[],
): string[] {
  const writtenHtml = contentBlocks
    .filter(b => b.content_html && (b.status === 'written' || b.status === 'approved') && b.type !== 'image')
    .map(b => b.content_html)
    .join(' ')

  if (!writtenHtml) return []

  const plainLower = writtenHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const saturated: string[] = []

  for (const connector of FORMAL_CONNECTORS) {
    const normalized = connector.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const regex = new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const matches = plainLower.match(regex)
    if (matches && matches.length >= 2) {
      saturated.push(connector)
    }
  }

  return saturated
}

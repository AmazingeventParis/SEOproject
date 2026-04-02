/**
 * Quality checks for written content blocks.
 */

/**
 * Check how well a written block covers its assigned key_ideas.
 * Returns coverage percentage and list of uncovered ideas.
 */
export function checkKeyIdeasCoverage(
  contentHtml: string,
  keyIdeas: string[]
): { coverage: number; covered: string[]; missing: string[] } {
  if (!keyIdeas || keyIdeas.length === 0) return { coverage: 100, covered: [], missing: [] }

  const plainText = contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()
  const covered: string[] = []
  const missing: string[] = []

  for (const idea of keyIdeas) {
    // Extract significant words from the key_idea (>3 chars)
    const ideaWords = idea.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    if (ideaWords.length === 0) { covered.push(idea); continue }

    // Check if at least 50% of significant words appear in the content
    const matchCount = ideaWords.filter(w => plainText.includes(w)).length
    const matchRatio = matchCount / ideaWords.length

    if (matchRatio >= 0.5) {
      covered.push(idea)
    } else {
      missing.push(idea)
    }
  }

  const coverage = Math.round((covered.length / keyIdeas.length) * 100)
  return { coverage, covered, missing }
}

/**
 * Verify that nuggets assigned to a block were actually integrated
 * into the written content (word-overlap matching).
 */
export interface NuggetCheckDetail {
  blockIndex: number
  heading: string | null
  nuggetId: string
  status: 'integrated' | 'ignored'
  matchScore: number
}

export interface NuggetIntegrationResult {
  totalAssigned: number
  totalIntegrated: number
  totalIgnored: number
  integrationRate: number
  details: NuggetCheckDetail[]
}

export function checkNuggetIntegration(
  contentHtml: string,
  nuggetContent: string,
): { integrated: boolean; matchScore: number } {
  const plainText = contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()

  // Extract significant words from nugget (>3 chars, no stop words)
  const stopWords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux',
    'et', 'ou', 'en', 'pour', 'par', 'sur', 'avec', 'sans', 'dans',
    'est', 'sont', 'the', 'and', 'for', 'that', 'this', 'with',
    'qui', 'que', 'quoi', 'nous', 'vous', 'ils', 'elle', 'elles',
    'plus', 'pas', 'bien', 'tres', 'aussi', 'mais', 'donc', 'comme',
  ])

  const nuggetWords = nuggetContent
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))

  if (nuggetWords.length === 0) return { integrated: true, matchScore: 100 }

  // Normalize plain text too for accent-insensitive matching
  const normalizedText = plainText.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const matchCount = nuggetWords.filter(w => normalizedText.includes(w)).length
  const matchScore = Math.round((matchCount / nuggetWords.length) * 100)

  // Consider integrated if at least 30% of significant words appear
  // (nuggets are paraphrased/integrated naturally, not copy-pasted)
  return { integrated: matchScore >= 30, matchScore }
}

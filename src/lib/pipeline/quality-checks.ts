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

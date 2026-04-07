// ============================================================
// Semrush CSV Parser
// Parses keyword exports from Semrush into structured data
// Supports multiple CSV formats (organic research, keyword magic tool, etc.)
// ============================================================

export interface ParsedKeyword {
  keyword: string
  volume: number
  difficulty: number
  cpc: number
  intent?: string // Semrush intent code
  competition?: number // 0-1
  results?: number // total SERP results
  trend?: string // monthly trend data
}

/**
 * Parse a Semrush CSV export into structured keyword data.
 * Handles multiple Semrush export formats:
 * - Organic Research: Keyword, Position, Volume, KD%, CPC, URL, Traffic, ...
 * - Keyword Magic Tool: Keyword, Volume, Trend, KD%, CPC, Com., SERP Features, Results, Intent
 * - Keyword Overview: Keyword, Volume, KD, CPC, Com., Results, Intent
 * - Domain Overview export
 */
export function parseSemrushCsv(csvText: string): ParsedKeyword[] {
  const lines = csvText.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  // Detect separator (Semrush uses ; or , depending on locale)
  const firstLine = lines[0]
  const separator = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  // Parse header
  const headers = parseCsvLine(lines[0], separator).map(h =>
    h.toLowerCase().trim().replace(/["%]/g, '').replace(/\s+/g, '_')
  )

  // Map header names to indices (handle multiple Semrush formats)
  const keywordIdx = findHeaderIndex(headers, ['keyword', 'mot-cle', 'mot_cle', 'mot_clé'])
  const volumeIdx = findHeaderIndex(headers, ['volume', 'search_volume', 'volume_de_recherche'])
  const difficultyIdx = findHeaderIndex(headers, ['kd', 'kd_', 'keyword_difficulty', 'difficulte', 'difficulty'])
  const cpcIdx = findHeaderIndex(headers, ['cpc', 'cpc_(usd)', 'cpc_(eur)', 'cout_par_clic'])
  const intentIdx = findHeaderIndex(headers, ['intent', 'intention', 'search_intent'])
  const competitionIdx = findHeaderIndex(headers, ['com.', 'competition', 'competitive_density', 'com'])
  const resultsIdx = findHeaderIndex(headers, ['results', 'number_of_results', 'resultats'])

  if (keywordIdx === -1) {
    throw new Error(`En-tete "Keyword" non trouve dans le CSV. Colonnes detectees: ${headers.join(', ')}`)
  }

  const keywords: ParsedKeyword[] = []
  const seen = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = parseCsvLine(line, separator)
    const keyword = (cols[keywordIdx] || '').trim().replace(/^"|"$/g, '')
    if (!keyword) continue

    // Deduplicate
    const kwLower = keyword.toLowerCase()
    if (seen.has(kwLower)) continue
    seen.add(kwLower)

    const volume = parseNumber(cols[volumeIdx])
    const difficulty = parseNumber(cols[difficultyIdx])
    const cpc = parseFloat((cols[cpcIdx] || '0').replace(',', '.').replace(/[^0-9.]/g, '')) || 0
    const intent = intentIdx !== -1 ? (cols[intentIdx] || '').trim() : undefined
    const competition = competitionIdx !== -1 ? parseFloat((cols[competitionIdx] || '0').replace(',', '.')) || 0 : undefined
    const results = resultsIdx !== -1 ? parseNumber(cols[resultsIdx]) : undefined

    keywords.push({
      keyword,
      volume,
      difficulty: Math.min(100, difficulty),
      cpc,
      intent,
      competition,
      results,
    })
  }

  return keywords
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h === candidate || h.startsWith(candidate))
    if (idx !== -1) return idx
  }
  return -1
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0
  // Handle formats: "1,200", "1.200", "1200", "1 200"
  const cleaned = val.replace(/[^0-9.,]/g, '').replace(/\s/g, '')
  // If both . and , exist, determine which is decimal
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // "1,200.50" or "1.200,50"
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      return parseInt(cleaned.replace(/\./g, '').replace(',', '.'), 10) || 0
    }
    return parseInt(cleaned.replace(/,/g, ''), 10) || 0
  }
  return parseInt(cleaned.replace(/,/g, ''), 10) || 0
}

function parseCsvLine(line: string, separator: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === separator && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

import type { VendorKeyword } from './types'

export function parseSemrushCSV(csvText: string): VendorKeyword[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const firstLine = lines[0]
  let sep = ','
  if (firstLine.split(';').length > firstLine.split(',').length) sep = ';'
  if (firstLine.split('\t').length > firstLine.split(sep).length) sep = '\t'

  const headers = parseCsvLine(firstLine, sep).map(h => h.trim().toLowerCase())

  const colMap = {
    keyword: findCol(headers, ['keyword', 'mot-clé', 'mot-cle', 'mot_cle']),
    position: findCol(headers, ['position', 'pos', 'pos.']),
    volume: findCol(headers, ['search volume', 'volume', 'volume de recherche']),
    traffic: findCol(headers, ['traffic', 'trafic']),
    traffic_percent: findCol(headers, ['traffic (%)', 'trafic (%)', 'traffic %']),
    url: findCol(headers, ['url', 'urls', 'landing page']),
  }

  if (colMap.keyword === -1) throw new Error('Colonne "Keyword" introuvable.')

  const keywords: VendorKeyword[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], sep)
    const keyword = cols[colMap.keyword]?.trim()
    if (!keyword) continue
    keywords.push({
      keyword,
      position: parseNum(cols[colMap.position]),
      volume: parseNum(cols[colMap.volume]),
      traffic: parseNum(cols[colMap.traffic]),
      traffic_percent: parseFloat(cols[colMap.traffic_percent] || '0') || 0,
      url: cols[colMap.url]?.trim() || '',
    })
  }

  keywords.sort((a, b) => b.traffic - a.traffic)
  return keywords.slice(0, 500)
}

function findCol(headers: string[], variants: string[]): number {
  for (const v of variants) {
    const idx = headers.indexOf(v)
    if (idx !== -1) return idx
  }
  for (const v of variants) {
    const idx = headers.findIndex(h => h.includes(v))
    if (idx !== -1) return idx
  }
  return -1
}

function parseNum(val: string | undefined): number {
  if (!val) return 0
  return Math.round(parseFloat(val.replace(/[^0-9.,\-]/g, '').replace(/,/g, '.')) || 0)
}

function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === sep && !inQuotes) {
      result.push(current); current = ''
    } else current += ch
  }
  result.push(current)
  return result
}

export function getKeywordsSummary(keywords: VendorKeyword[]) {
  if (keywords.length === 0) return null
  return {
    total_keywords: keywords.length,
    total_traffic: keywords.reduce((s, k) => s + k.traffic, 0),
    avg_position: Math.round(keywords.reduce((s, k) => s + k.position, 0) / keywords.length * 10) / 10,
    top_3: keywords.filter(k => k.position <= 3).length,
    top_10: keywords.filter(k => k.position <= 10).length,
    top_keywords: keywords.slice(0, 10).map(k => ({ keyword: k.keyword, position: k.position, traffic: k.traffic })),
  }
}

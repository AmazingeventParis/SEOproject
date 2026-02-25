// ============================================================
// Serper.dev API client for SERP analysis
// API docs: POST https://google.serper.dev/search
// ============================================================

import { getServerClient } from '@/lib/supabase/client'

// ---- Types ----

export interface SERPResult {
  organic: SERPOrganic[]
  peopleAlsoAsk: PeopleAlsoAsk[]
  relatedSearches: RelatedSearch[]
  searchParameters: { q: string; gl: string; hl: string }
  knowledgeGraph?: KnowledgeGraph
}

export interface SERPOrganic {
  position: number
  title: string
  link: string
  snippet: string
  domain: string
}

export interface PeopleAlsoAsk {
  question: string
  snippet: string
  link: string
}

export interface RelatedSearch {
  query: string
}

export interface KnowledgeGraph {
  title: string
  type: string
  description: string
}

// ---- Internal helpers ----

/**
 * Resolve the Serper API key.
 * Priority: SERPER_API_KEY env var > seo_config table row with key "serper"
 */
async function getSerperApiKey(): Promise<string> {
  // 1. Try environment variable first
  const envKey = process.env.SERPER_API_KEY
  if (envKey) return envKey

  // 2. Fall back to seo_config table (key saved by Settings page as "serper_api_key")
  try {
    const supabase = getServerClient()
    const { data, error } = await supabase
      .from('seo_config')
      .select('value')
      .eq('key', 'serper_api_key')
      .single()

    if (!error && data?.value) {
      const val = data.value as unknown
      // Settings page stores the value as a plain string
      if (typeof val === 'string' && val.length > 0) return val
      // Also support nested object format {"api_key": "..."}
      if (typeof val === 'object' && 'api_key' in (val as Record<string, unknown>)) {
        const key = (val as { api_key: string }).api_key
        if (key) return key
      }
    }
  } catch {
    // Supabase not available or table missing - fall through
  }

  throw new Error(
    'Cle API Serper non configuree. ' +
    'Configurez-la dans Settings ou via la variable SERPER_API_KEY.'
  )
}

/**
 * Extract the domain from a full URL.
 * e.g. "https://www.example.com/path" -> "www.example.com"
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ---- Main API functions ----

/**
 * Analyze SERP for a keyword via Serper.dev.
 *
 * @param keyword  The search query to analyze
 * @param options  Optional country, language and result count overrides
 * @returns        Structured SERP result with organic, PAA, related searches, etc.
 */
export async function analyzeSERP(
  keyword: string,
  options?: {
    gl?: string   // country code, default 'fr'
    hl?: string   // language, default 'fr'
    num?: number  // results count, default 10
  }
): Promise<SERPResult> {
  const apiKey = await getSerperApiKey()

  const gl = options?.gl ?? 'fr'
  const hl = options?.hl ?? 'fr'
  const num = options?.num ?? 10

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: keyword, gl, hl, num }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown error')
    throw new Error(
      `Serper API returned ${response.status}: ${body}. ` +
      'Check your API key and quota at https://serper.dev/dashboard.'
    )
  }

  const raw = await response.json()

  // Map the Serper response into our normalised shape
  const organic: SERPOrganic[] = (raw.organic ?? []).map(
    (item: Record<string, unknown>, idx: number) => ({
      position: (item.position as number) ?? idx + 1,
      title: (item.title as string) ?? '',
      link: (item.link as string) ?? '',
      snippet: (item.snippet as string) ?? '',
      domain: extractDomain((item.link as string) ?? ''),
    })
  )

  const peopleAlsoAsk: PeopleAlsoAsk[] = (raw.peopleAlsoAsk ?? []).map(
    (item: Record<string, unknown>) => ({
      question: (item.question as string) ?? '',
      snippet: (item.snippet as string) ?? '',
      link: (item.link as string) ?? '',
    })
  )

  const relatedSearches: RelatedSearch[] = (raw.relatedSearches ?? []).map(
    (item: Record<string, unknown>) => ({
      query: (item.query as string) ?? '',
    })
  )

  let knowledgeGraph: KnowledgeGraph | undefined
  if (raw.knowledgeGraph) {
    const kg = raw.knowledgeGraph as Record<string, unknown>
    knowledgeGraph = {
      title: (kg.title as string) ?? '',
      type: (kg.type as string) ?? '',
      description: (kg.description as string) ?? '',
    }
  }

  return {
    organic,
    peopleAlsoAsk,
    relatedSearches,
    searchParameters: { q: keyword, gl, hl },
    knowledgeGraph,
  }
}

// ---- Competitor insight extraction ----

export interface CompetitorInsights {
  avgTitleLength: number
  avgSnippetLength: number
  commonTitlePatterns: string[]
  topDomains: string[]
  paaQuestions: string[]
}

/**
 * Analyze SERP results to extract competitor patterns and insights.
 * Useful for understanding what makes top-ranking pages successful.
 */
export function extractCompetitorInsights(serp: SERPResult): CompetitorInsights {
  const organicResults = serp.organic

  // --- Average title & snippet lengths ---
  const avgTitleLength =
    organicResults.length > 0
      ? Math.round(
          organicResults.reduce((sum, r) => sum + r.title.length, 0) /
            organicResults.length
        )
      : 0

  const avgSnippetLength =
    organicResults.length > 0
      ? Math.round(
          organicResults.reduce((sum, r) => sum + r.snippet.length, 0) /
            organicResults.length
        )
      : 0

  // --- Common title patterns ---
  // Detect recurring structural patterns in titles
  const patterns: string[] = []

  const titlesLower = organicResults.map((r) => r.title.toLowerCase())

  // Check for numbered list pattern ("10 ...", "5 ...")
  const numberedCount = titlesLower.filter((t) => /^\d+\s/.test(t)).length
  if (numberedCount >= 2) patterns.push('Listicle (chiffre en debut de titre)')

  // Check for "how to" / "comment" pattern
  const howToCount = titlesLower.filter(
    (t) => t.includes('comment') || t.includes('how to') || t.includes('guide')
  ).length
  if (howToCount >= 2) patterns.push('Guide / How-to')

  // Check for year pattern (e.g. "2025", "2026")
  const yearCount = titlesLower.filter((t) => /20\d{2}/.test(t)).length
  if (yearCount >= 2) patterns.push('Annee dans le titre (fraicheur)')

  // Check for comparison pattern
  const vsCount = titlesLower.filter(
    (t) => t.includes(' vs ') || t.includes('comparatif') || t.includes('comparison')
  ).length
  if (vsCount >= 2) patterns.push('Comparaison / Versus')

  // Check for question pattern
  const questionCount = titlesLower.filter(
    (t) =>
      t.includes('?') ||
      t.startsWith('pourquoi') ||
      t.startsWith("qu'est") ||
      t.startsWith('what') ||
      t.startsWith('why')
  ).length
  if (questionCount >= 2) patterns.push('Question dans le titre')

  // Check for "best / meilleur" pattern
  const bestCount = titlesLower.filter(
    (t) => t.includes('meilleur') || t.includes('best') || t.includes('top')
  ).length
  if (bestCount >= 2) patterns.push('Superlatif (meilleur, top, best)')

  if (patterns.length === 0) patterns.push('Pas de pattern dominant identifie')

  // --- Top domains (unique, ordered by best position) ---
  const seenDomains = new Set<string>()
  const topDomains: string[] = []
  for (const r of organicResults) {
    const domain = r.domain.replace(/^www\./, '')
    if (!seenDomains.has(domain)) {
      seenDomains.add(domain)
      topDomains.push(domain)
    }
    if (topDomains.length >= 10) break
  }

  // --- People Also Ask questions ---
  const paaQuestions = serp.peopleAlsoAsk.map((p) => p.question)

  return {
    avgTitleLength,
    avgSnippetLength,
    commonTitlePatterns: patterns,
    topDomains,
    paaQuestions,
  }
}

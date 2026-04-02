// ============================================================
// Revamp Comparator — Compare old content vs SERP top results
// Identifies gaps, outdated info, and strengths to preserve
// ============================================================

import { routeAI } from '@/lib/ai/router'
import { getSerperApiKey } from '@/lib/seo/serper'
import type { ContentBlock } from '@/lib/supabase/types'
import type { RevampSERPComparison, RevampGSCData } from './types'

interface SerperResult {
  title: string
  link: string
  snippet: string
}

/**
 * Fetch top 5 SERP results for a keyword using Serper.dev.
 */
async function fetchSERPResults(keyword: string): Promise<SerperResult[]> {
  const apiKey = await getSerperApiKey()

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: keyword,
      gl: 'fr',
      hl: 'fr',
      num: 5,
    }),
  })

  if (!res.ok) {
    throw new Error(`Serper API error (${res.status})`)
  }

  const data = await res.json()
  return (data.organic || []).slice(0, 5).map((r: Record<string, string>) => ({
    title: r.title || '',
    link: r.link || '',
    snippet: r.snippet || '',
  }))
}

/**
 * Compare the old article content with SERP competitors.
 * Uses AI to identify missing topics, outdated sections, and strengths to keep.
 */
export async function compareWithSERP(
  keyword: string,
  originalBlocks: ContentBlock[],
  gscData: RevampGSCData,
): Promise<RevampSERPComparison> {
  // Fetch SERP results
  const serpResults = await fetchSERPResults(keyword)

  // Build a summary of the old article
  const oldArticleSummary = originalBlocks
    .map((b, i) => {
      const heading = b.heading ? `[${b.type.toUpperCase()}] ${b.heading}` : `[Bloc ${i}]`
      const wordInfo = `(${b.word_count} mots)`
      const content = b.content_html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
      return `${heading} ${wordInfo}\n${content}...`
    })
    .join('\n\n')

  // Build SERP competitor info
  const serpSummary = serpResults
    .map((r, i) => `${i + 1}. "${r.title}" — ${r.link}\n   ${r.snippet}`)
    .join('\n\n')

  // GSC opportunity keywords
  const opportunityKws = gscData.opportunityKeywords
    .slice(0, 5)
    .map(k => `"${k.query}" (pos ${k.position.toFixed(0)}, ${k.impressions} impressions)`)
    .join(', ')

  const prompt = `Tu es un expert SEO francais. Analyse cet article existant et compare-le aux resultats SERP actuels pour le mot-cle "${keyword}".

## ARTICLE ACTUEL
${oldArticleSummary}

## TOP RESULTATS SERP
${serpSummary}

## MOTS-CLES OPPORTUNITES (GSC)
${opportunityKws || 'Aucun'}

## TACHE
Compare l'article actuel aux concurrents SERP et identifie :

1. **missingTopics**: Sujets/sous-sujets couverts par les concurrents mais absents de l'article (liste de strings)
2. **outdatedSections**: Sections de l'article qui semblent obsoletes ou avec des informations perimees (liste de strings avec le heading concerne)
3. **strengthsToKeep**: Points forts de l'article actuel a conserver absolument (contenu unique, expertise, exemples concrets)
4. **competitors**: Pour chaque concurrent SERP, extrais : url, title, headings (devines du snippet/titre), wordCount (estime), hasImages, hasFaq, hasTables

Reponds en JSON strict :
{
  "competitors": [{ "url": "...", "title": "...", "headings": ["..."], "wordCount": 0, "hasImages": false, "hasFaq": false, "hasTables": false }],
  "missingTopics": ["..."],
  "outdatedSections": ["..."],
  "strengthsToKeep": ["..."]
}`

  const response = await routeAI('analyze_serp', [
    { role: 'user', content: prompt },
  ])

  try {
    let jsonStr = response.content.trim()
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    }
    const parsed = JSON.parse(jsonStr)
    return {
      competitors: (parsed.competitors || []).map((c: Record<string, unknown>) => ({
        url: String(c.url || ''),
        title: String(c.title || ''),
        headings: (c.headings as string[]) || [],
        wordCount: Number(c.wordCount) || 0,
        hasImages: Boolean(c.hasImages),
        hasFaq: Boolean(c.hasFaq),
        hasTables: Boolean(c.hasTables),
      })),
      missingTopics: (parsed.missingTopics || []) as string[],
      outdatedSections: (parsed.outdatedSections || []) as string[],
      strengthsToKeep: (parsed.strengthsToKeep || []) as string[],
    }
  } catch {
    // Fallback if JSON parsing fails
    return {
      competitors: serpResults.map(r => ({
        url: r.link,
        title: r.title,
        headings: [],
        wordCount: 0,
        hasImages: false,
        hasFaq: false,
        hasTables: false,
      })),
      missingTopics: [],
      outdatedSections: [],
      strengthsToKeep: [],
    }
  }
}

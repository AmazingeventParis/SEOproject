// ============================================================
// Anti-cannibalization checker
// Detects keyword conflicts between articles on the same site
// Uses the seo_check_cannibalization RPC function in Supabase
// ============================================================

import { getServerClient } from '@/lib/supabase/client'

// ---- Types ----

export interface CannibalizationConflict {
  articleId: string
  keyword: string
  title: string | null
  status: string
  similarity: number
}

export interface CannibalizationResult {
  hasConflict: boolean
  conflicts: CannibalizationConflict[]
  recommendation: string
  maxSimilarity: number
}

// ---- Severity thresholds ----

const THRESHOLD_BLOCKING = 0.7
const THRESHOLD_WARNING = 0.5
const THRESHOLD_NOTICE = 0.3

// ---- Main function ----

/**
 * Check if a keyword would cannibalize existing articles on the same site.
 *
 * This calls the `seo_check_cannibalization` Postgres RPC which performs
 * trigram similarity matching against all existing article keywords for
 * the given site.
 *
 * @param keyword          The keyword to check
 * @param siteId           The site UUID to scope the check to
 * @param excludeArticleId Optional article ID to exclude (useful when editing)
 * @returns                Cannibalization result with conflicts and recommendation
 */
export async function checkCannibalization(
  keyword: string,
  siteId: string,
  excludeArticleId?: string
): Promise<CannibalizationResult> {
  const supabase = getServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('seo_check_cannibalization', {
    p_keyword: keyword,
    p_site_id: siteId,
  })

  if (error) {
    throw new Error(`Cannibalization check failed: ${(error as { message: string }).message}`)
  }

  // Map and filter results
  let conflicts: CannibalizationConflict[] = ((data as Record<string, unknown>[] | null) || []).map(
    (row: Record<string, unknown>) => ({
      articleId: row.article_id as string,
      keyword: row.keyword as string,
      title: (row.title as string) ?? null,
      status: row.status as string,
      similarity: row.similarity as number,
    })
  )

  // Exclude the current article if editing
  if (excludeArticleId) {
    conflicts = conflicts.filter((c) => c.articleId !== excludeArticleId)
  }

  // Sort by similarity descending
  conflicts.sort((a, b) => b.similarity - a.similarity)

  // Determine max similarity and recommendation
  const maxSimilarity =
    conflicts.length > 0 ? Math.max(...conflicts.map((c) => c.similarity)) : 0

  let recommendation: string

  if (maxSimilarity > THRESHOLD_BLOCKING) {
    recommendation =
      'BLOQUANT - Un article tres similaire existe deja. ' +
      'Envisagez de fusionner les contenus ou de differencier radicalement l\'angle.'
  } else if (maxSimilarity > THRESHOLD_WARNING) {
    recommendation =
      'ATTENTION - Sujet proche detecte. ' +
      'Assurez-vous de differencier clairement l\'angle editorial et l\'intention de recherche.'
  } else if (maxSimilarity > THRESHOLD_NOTICE) {
    recommendation =
      'OK - Similitude legere detectee. ' +
      'Veillez a creer des liens internes entre les articles proches.'
  } else {
    recommendation = 'OK - Aucun conflit de cannibalisation detecte.'
  }

  return {
    hasConflict: maxSimilarity > THRESHOLD_WARNING,
    conflicts,
    recommendation,
    maxSimilarity,
  }
}

/**
 * Batch-check multiple keywords against a site.
 * Returns a map of keyword -> CannibalizationResult.
 */
export async function checkCannibalizationBatch(
  keywords: string[],
  siteId: string,
  excludeArticleId?: string
): Promise<Map<string, CannibalizationResult>> {
  const results = new Map<string, CannibalizationResult>()

  // Run checks in parallel (limited concurrency)
  const CONCURRENCY = 5
  for (let i = 0; i < keywords.length; i += CONCURRENCY) {
    const batch = keywords.slice(i, i + CONCURRENCY)
    const promises = batch.map((kw) =>
      checkCannibalization(kw, siteId, excludeArticleId).then((result) => ({
        keyword: kw,
        result,
      }))
    )
    const batchResults = await Promise.all(promises)
    for (const { keyword, result } of batchResults) {
      results.set(keyword, result)
    }
  }

  return results
}

/**
 * Get a human-readable severity label from a similarity score.
 */
export function getSeverityLabel(
  similarity: number
): 'none' | 'low' | 'medium' | 'high' {
  if (similarity > THRESHOLD_BLOCKING) return 'high'
  if (similarity > THRESHOLD_WARNING) return 'medium'
  if (similarity > THRESHOLD_NOTICE) return 'low'
  return 'none'
}

/**
 * Get a color class for the severity (for UI display).
 */
export function getSeverityColor(similarity: number): string {
  if (similarity > THRESHOLD_BLOCKING) return 'text-red-600'
  if (similarity > THRESHOLD_WARNING) return 'text-orange-500'
  if (similarity > THRESHOLD_NOTICE) return 'text-yellow-500'
  return 'text-green-600'
}

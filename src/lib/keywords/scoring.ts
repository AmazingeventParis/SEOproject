// ============================================================
// Keyword Priority Scoring Engine
// Scores keywords based on site growth phase with adaptive weights
// ============================================================

export type GrowthPhase = 'sandbox' | 'authority' | 'monetization'

export interface KeywordMetrics {
  volume: number
  difficulty: number // 0-100
  cpc: number
  kgr?: number // Keyword Golden Ratio (allintitle / volume)
  currentPosition?: number // from GSC
  siloId?: string | null
  searchIntent?: string
}

interface PhaseWeights {
  kgrEasy: number
  volume: number
  lowDifficulty: number
  siloFit: number
  cpcIntent: number
  gscOpportunity: number
}

const PHASE_WEIGHTS: Record<GrowthPhase, PhaseWeights> = {
  sandbox: {
    kgrEasy: 0.35,
    volume: 0.10,
    lowDifficulty: 0.30,
    siloFit: 0.15,
    cpcIntent: 0.05,
    gscOpportunity: 0.05,
  },
  authority: {
    kgrEasy: 0.15,
    volume: 0.25,
    lowDifficulty: 0.20,
    siloFit: 0.25,
    cpcIntent: 0.10,
    gscOpportunity: 0.05,
  },
  monetization: {
    kgrEasy: 0.10,
    volume: 0.20,
    lowDifficulty: 0.10,
    siloFit: 0.15,
    cpcIntent: 0.35,
    gscOpportunity: 0.10,
  },
}

/**
 * Compute a priority score (0-100) for a keyword based on the site's growth phase.
 */
export function computePriorityScore(
  metrics: KeywordMetrics,
  phase: GrowthPhase,
  maxVolume: number = 10000,
): number {
  const weights = PHASE_WEIGHTS[phase]

  // 1. KGR score (lower = better, < 0.25 is gold)
  let kgrScore = 0.5 // default if no KGR data
  if (metrics.kgr !== undefined && metrics.kgr !== null) {
    if (metrics.kgr < 0.25) kgrScore = 1.0
    else if (metrics.kgr < 0.5) kgrScore = 0.7
    else if (metrics.kgr < 1.0) kgrScore = 0.4
    else kgrScore = 0.1
  }

  // 2. Volume score (normalized, log scale for big volumes)
  const volNorm = maxVolume > 0
    ? Math.min(1, Math.log10(Math.max(1, metrics.volume)) / Math.log10(Math.max(10, maxVolume)))
    : 0

  // 3. Low difficulty score (inverted: 0 difficulty = score 1.0)
  const diffScore = 1 - Math.min(1, metrics.difficulty / 100)

  // 4. Silo fit (binary: has silo = 1, no silo = 0.3)
  const siloScore = metrics.siloId ? 1.0 : 0.3

  // 5. CPC / transactional intent score
  let cpcScore = 0
  if (metrics.cpc > 5) cpcScore = 1.0
  else if (metrics.cpc > 2) cpcScore = 0.7
  else if (metrics.cpc > 0.5) cpcScore = 0.4
  else if (metrics.cpc > 0) cpcScore = 0.2
  // Boost for transactional intents
  if (metrics.searchIntent === 'lead_gen' || metrics.searchIntent === 'review' || metrics.searchIntent === 'comparison') {
    cpcScore = Math.max(cpcScore, 0.6)
  }

  // 6. GSC opportunity (already ranking 5-20 = big opportunity)
  let gscScore = 0
  if (metrics.currentPosition) {
    if (metrics.currentPosition >= 5 && metrics.currentPosition <= 20) gscScore = 1.0
    else if (metrics.currentPosition >= 1 && metrics.currentPosition < 5) gscScore = 0.3 // already top, less priority
    else if (metrics.currentPosition > 20 && metrics.currentPosition <= 50) gscScore = 0.4
  }

  // Weighted sum
  const raw =
    kgrScore * weights.kgrEasy +
    volNorm * weights.volume +
    diffScore * weights.lowDifficulty +
    siloScore * weights.siloFit +
    cpcScore * weights.cpcIntent +
    gscScore * weights.gscOpportunity

  return Math.round(raw * 100)
}

/**
 * Classify keyword intent from Semrush intent codes or keyword text.
 */
export function classifyIntent(keyword: string, semrushIntent?: string): string {
  // Semrush intent codes: 0=informational, 1=navigational, 2=commercial, 3=transactional
  if (semrushIntent === '3' || semrushIntent === 'transactional') return 'lead_gen'
  if (semrushIntent === '2' || semrushIntent === 'commercial') return 'comparison'
  if (semrushIntent === '1' || semrushIntent === 'navigational') return 'traffic'

  const kw = keyword.toLowerCase()
  if (/\b(meilleur|comparatif|vs|versus|ou\s+choisir|quel\s+choisir)\b/.test(kw)) return 'comparison'
  if (/\b(avis|test|review|experience)\b/.test(kw)) return 'review'
  if (/\b(prix|tarif|cout|devis|pas\s+cher|achat|acheter|commander)\b/.test(kw)) return 'lead_gen'
  if (/\b(comment|pourquoi|guide|tuto|definition|c.?est\s+quoi)\b/.test(kw)) return 'informational'

  return 'traffic'
}

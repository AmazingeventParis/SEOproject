import type { VendorKeyword, LinkScores } from './types'

interface OpportunityMetrics {
  tf: number
  cf: number
  da: number
  dr: number
  organic_traffic: number
  price: number
  vendor_keywords: VendorKeyword[]
  target_keyword: string
  topical_relevance_ai: number
}

const DEFAULT_WEIGHTS = { roi: 0.25, power: 0.20, keyword: 0.15, safety: 0.20, topical: 0.20 }

export function computeROI(metrics: Pick<OpportunityMetrics, 'organic_traffic' | 'da' | 'tf' | 'price'>): number {
  const { organic_traffic, da, tf, price } = metrics
  const valueScore = (organic_traffic / 1000) * 30 + (da / 100) * 40 + (tf / 100) * 30
  return Math.min(100, Math.max(0, Math.round((valueScore / Math.max(price, 1)) * 100)))
}

export function computePower(metrics: Pick<OpportunityMetrics, 'tf' | 'da' | 'dr'>): number {
  return Math.min(100, Math.max(0, Math.round((metrics.tf * 0.5) + (metrics.da * 0.3) + (Math.min(metrics.dr, 100) * 0.2))))
}

export function computeKeywordScore(vendorKeywords: VendorKeyword[], targetKeyword: string): number {
  if (!vendorKeywords || vendorKeywords.length === 0 || !targetKeyword) return 0
  const targetWords = targetKeyword.toLowerCase().split(/\s+/)
  const overlapping = vendorKeywords.filter(vk => {
    const kw = vk.keyword.toLowerCase()
    return targetWords.some(tw => kw.includes(tw)) || kw.includes(targetKeyword.toLowerCase())
  })
  if (overlapping.length === 0) return 0
  const avgPosition = overlapping.reduce((sum, k) => sum + k.position, 0) / overlapping.length
  return Math.min(100, Math.max(0, Math.round((overlapping.length * 15) + Math.max(0, (30 - avgPosition) * 2))))
}

export function computeSafety(tf: number, cf: number): number {
  if (cf === 0) return tf > 0 ? 90 : 50
  const ratio = tf / cf
  if (ratio >= 0.8) return 95
  if (ratio >= 0.5) return 80
  if (ratio >= 0.3) return 60
  if (ratio >= 0.15) return 35
  return 10
}

export function getSafetyAlert(tf: number, cf: number): string | null {
  if (cf === 0) return null
  const ratio = tf / cf
  if (ratio < 0.15) return `⛔ RISQUE SPAM ELEVE : TF/CF = ${ratio.toFixed(2)}. Le CF (${cf}) est ${Math.round(cf / Math.max(tf, 1))}x superieur au TF (${tf}).`
  if (ratio < 0.3) return `⚠️ RISQUE MODERE : TF/CF = ${ratio.toFixed(2)}. Profil suspect.`
  return null
}

export function computeAllScores(metrics: OpportunityMetrics, weights = DEFAULT_WEIGHTS): LinkScores {
  const roi = computeROI(metrics)
  const power = computePower(metrics)
  const keyword = computeKeywordScore(metrics.vendor_keywords, metrics.target_keyword || '')
  const safety = computeSafety(metrics.tf, metrics.cf)
  const topical = Math.round(metrics.topical_relevance_ai)
  const w = { ...DEFAULT_WEIGHTS, ...weights }
  const overall = Math.round(roi * w.roi + power * w.power + keyword * w.keyword + safety * w.safety + topical * w.topical)
  return { roi, power, keyword, safety, topical, overall: Math.min(100, overall) }
}

export function classifyOpportunity(scores: LinkScores): string[] {
  const labels: string[] = []
  if (scores.roi >= 70) labels.push('Best ROI')
  if (scores.power >= 70) labels.push('Power Booster')
  if (scores.keyword >= 60) labels.push('Keyword Ranker')
  if (scores.safety <= 40) labels.push('Risque Spam')
  if (scores.topical >= 75) labels.push('Haute pertinence')
  return labels
}

export function simulateImpact(overallScore: number, price: number, currentPosition: number) {
  const baseGain = overallScore >= 80 ? 5 : overallScore >= 60 ? 3 : overallScore >= 40 ? 1.5 : 0.5
  const multiplier = currentPosition > 10 ? 1.2 : currentPosition > 5 ? 1 : 0.5
  const gain = Math.round(baseGain * multiplier * 10) / 10
  const confidence = overallScore >= 70 ? 'medium' as const : 'low' as const
  const rationale = `Score ${overallScore}/100. Gain estime ~${gain} positions. ${price > 200 ? 'Investissement important' : 'Cout raisonnable'} (${price}€). Estimation ${confidence === 'medium' ? 'moderement fiable' : 'indicative'}.`
  return { estimated_gain: gain, confidence, rationale }
}

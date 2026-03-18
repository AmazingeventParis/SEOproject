import { routeAI } from '@/lib/ai/router'
import type { GapAnalysis, GeneratedArticle } from './types'

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Pas de JSON dans la reponse IA')
  return cleaned.slice(start, end + 1)
}

export async function analyzeGap(params: {
  siteDomain: string; siteNiche: string;
  tf: number; cf: number; da: number; dr: number;
  referringDomains: number; organicTraffic: number;
}): Promise<GapAnalysis> {
  const prompt = `Tu es un consultant SEO Senior specialise en netlinking. Analyse le profil de liens.

SITE : ${params.siteDomain}
NICHE : ${params.siteNiche}
METRIQUES :
- Trust Flow (TF) : ${params.tf} | Citation Flow (CF) : ${params.cf}
- Domain Authority (DA) : ${params.da} | Domain Rating (DR) : ${params.dr}
- Domaines referents : ${params.referringDomains} | Trafic organique : ${params.organicTraffic}/mois

Reponds UNIQUEMENT en JSON valide :
{
  "summary": "Synthese 3-5 phrases",
  "strengths": ["Force 1", "Force 2"],
  "weaknesses": ["Faiblesse 1 avec explication", "Faiblesse 2"],
  "priorities": ["Action 1 avec detail", "Action 2", "Action 3", "Action 4", "Action 5"],
  "anchor_distribution": null
}

Sois precis et actionnable. Donne des chiffres cibles. Compare aux standards de la niche "${params.siteNiche}".`

  const response = await routeAI('analyze_link_gap', [{ role: 'user', content: prompt }])
  return JSON.parse(extractJson(response.content)) as GapAnalysis
}

export async function computeTopicalRelevance(params: {
  vendorDomain: string; vendorNiche: string | null;
  vendorTopKeywords: string[]; siteNiche: string; targetKeyword: string;
}): Promise<{ score: number; rationale: string }> {
  const prompt = `Note de 0 a 100 la pertinence thematique pour un achat de lien.

VENDEUR : ${params.vendorDomain} — niche "${params.vendorNiche || 'Non specifiee'}"
MOTS-CLES VENDEUR : ${params.vendorTopKeywords.slice(0, 20).join(', ') || 'Aucun'}
SITE CIBLE NICHE : ${params.siteNiche}
MOT-CLE CIBLE : ${params.targetKeyword}

Bareme : 90-100 meme thematique, 70-89 connexe forte, 50-69 indirect, 30-49 different, 0-29 aucun rapport.

Reponds UNIQUEMENT en JSON : {"score": <number>, "rationale": "<explication courte>"}`

  try {
    const response = await routeAI('analyze_link_gap', [{ role: 'user', content: prompt }])
    return JSON.parse(extractJson(response.content))
  } catch {
    return { score: 50, rationale: 'Analyse non disponible' }
  }
}

export async function generateNetlinkingArticle(params: {
  vendorDomain: string; vendorNiche: string | null;
  targetPageUrl: string; targetKeyword: string;
  siteDomain: string; siteNiche: string;
  anchorProfile?: { exact: number; broad: number; brand: number };
}): Promise<GeneratedArticle> {
  let anchorGuidance = 'Equilibre les 3 types d\'ancres.'
  if (params.anchorProfile) {
    const { exact, broad, brand } = params.anchorProfile
    const total = exact + broad + brand || 1
    if (exact / total > 0.4) anchorGuidance = 'ATTENTION : trop d\'ancres exactes. Privilegier LARGE ou MARQUE.'
    else if (brand / total < 0.1) anchorGuidance = 'Profil manque d\'ancres de marque. Privilegier MARQUE.'
  }

  const prompt = `Redige un article de netlinking en francais.

SITE VENDEUR : ${params.vendorDomain} — niche "${params.vendorNiche || 'generaliste'}"
PAGE CIBLE : ${params.targetPageUrl}
MOT-CLE : "${params.targetKeyword}"
SITE CIBLE : ${params.siteDomain} — niche "${params.siteNiche}"

CONSIGNES :
1. Article optimise pour le site vendeur
2. Pont naturel vers la page cible
3. 700-1000 mots, style informatif
4. Lien integre naturellement (pas en conclusion)
5. ${anchorGuidance}

Propose 3 ancres (exacte, large, marque).

JSON uniquement :
{
  "title": "Titre",
  "content_html": "<p>Article HTML...</p>",
  "word_count": <number>,
  "anchors": [
    {"type": "exact", "text": "ancre", "context_sentence": "Phrase avec <a href=\\"${params.targetPageUrl}\\">ancre</a>."},
    {"type": "broad", "text": "ancre large", "context_sentence": "..."},
    {"type": "brand", "text": "${params.siteDomain}", "context_sentence": "..."}
  ]
}`

  const response = await routeAI('generate_netlinking_article', [{ role: 'user', content: prompt }])
  const result = JSON.parse(extractJson(response.content)) as GeneratedArticle
  result.target_url = params.targetPageUrl
  result.target_keyword = params.targetKeyword
  return result
}

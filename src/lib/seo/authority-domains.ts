// ============================================================
// Authority Domain Registry — Weighted by niche for E-E-A-T
// Used by: suggest-authority-links, orchestrator (plan step)
// ============================================================

/**
 * General authority domains recognized across all niches.
 */
const GENERAL_AUTHORITY_DOMAINS = [
  // Encyclopedias & reference
  'wikipedia.org',
  // Government & public institutions (FR)
  'gouv.fr', 'service-public.fr', 'legifrance.gouv.fr',
  // European & international institutions
  'europa.eu', 'who.int', 'oecd.org', 'worldbank.org',
  // Academic & scientific publishers
  '.edu', 'nature.com', 'sciencedirect.com', 'springer.com',
  'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov', 'jstor.org',
  'researchgate.net', 'hal.science',
  // Major media (FR)
  'lemonde.fr', 'lefigaro.fr', 'francetvinfo.fr', 'liberation.fr',
  'lesechos.fr', 'lexpansion.lexpress.fr',
]

/**
 * Niche-specific authority domains with relevance weight (1-3).
 * Weight 3 = top-tier for this niche, 2 = strong, 1 = relevant.
 */
const NICHE_AUTHORITY_DOMAINS: Record<string, { domain: string; weight: number }[]> = {
  // Sante, bien-etre, medical
  sante: [
    { domain: 'has-sante.fr', weight: 3 },
    { domain: 'ansm.sante.fr', weight: 3 },
    { domain: 'anses.fr', weight: 3 },
    { domain: 'ameli.fr', weight: 3 },
    { domain: 'inserm.fr', weight: 3 },
    { domain: 'pasteur.fr', weight: 2 },
    { domain: 'vidal.fr', weight: 2 },
    { domain: 'doctissimo.fr', weight: 1 },
    { domain: 'mangerbouger.fr', weight: 2 },
    { domain: 'who.int', weight: 3 },
  ],
  // Environnement, energie, habitat durable
  environnement: [
    { domain: 'ademe.fr', weight: 3 },
    { domain: 'ecologie.gouv.fr', weight: 3 },
    { domain: 'notre-environnement.gouv.fr', weight: 2 },
    { domain: 'cerema.fr', weight: 2 },
    { domain: 'negawatt.org', weight: 2 },
    { domain: 'enerplan.eu', weight: 1 },
    { domain: 'qualitel.org', weight: 2 },
    { domain: 'effy.fr', weight: 1 },
    { domain: 'france-renov.gouv.fr', weight: 3 },
    { domain: 'rt-re-batiment.fr', weight: 2 },
  ],
  habitat: [
    { domain: 'ademe.fr', weight: 3 },
    { domain: 'france-renov.gouv.fr', weight: 3 },
    { domain: 'anah.gouv.fr', weight: 3 },
    { domain: 'qualitel.org', weight: 2 },
    { domain: 'cerema.fr', weight: 2 },
    { domain: 'ffbatiment.fr', weight: 2 },
    { domain: 'promotelec.com', weight: 2 },
    { domain: 'cstb.fr', weight: 2 },
    { domain: 'rt-re-batiment.fr', weight: 2 },
    { domain: 'quelleenergie.fr', weight: 1 },
  ],
  // Finance, economie, investissement
  finance: [
    { domain: 'insee.fr', weight: 3 },
    { domain: 'amf-france.org', weight: 3 },
    { domain: 'banque-france.fr', weight: 3 },
    { domain: 'economie.gouv.fr', weight: 3 },
    { domain: 'impots.gouv.fr', weight: 3 },
    { domain: 'lafinancepourtous.com', weight: 2 },
    { domain: 'acpr.banque-france.fr', weight: 2 },
    { domain: 'cbanque.com', weight: 1 },
    { domain: 'moneyvox.fr', weight: 1 },
    { domain: 'service-public.fr', weight: 2 },
  ],
  // Droit, juridique
  droit: [
    { domain: 'legifrance.gouv.fr', weight: 3 },
    { domain: 'service-public.fr', weight: 3 },
    { domain: 'dalloz.fr', weight: 2 },
    { domain: 'lexisnexis.fr', weight: 2 },
    { domain: 'justice.gouv.fr', weight: 3 },
    { domain: 'conseil-constitutionnel.fr', weight: 2 },
    { domain: 'vie-publique.fr', weight: 2 },
  ],
  // Tech, informatique, digital
  tech: [
    { domain: 'cnil.fr', weight: 3 },
    { domain: 'anssi.gouv.fr', weight: 3 },
    { domain: 'w3.org', weight: 2 },
    { domain: 'developer.mozilla.org', weight: 2 },
    { domain: 'web.dev', weight: 2 },
    { domain: 'techcrunch.com', weight: 1 },
    { domain: 'arxiv.org', weight: 2 },
    { domain: 'acm.org', weight: 2 },
    { domain: 'ieee.org', weight: 2 },
  ],
  // Marketing, SEO, business
  marketing: [
    { domain: 'searchengineland.com', weight: 2 },
    { domain: 'searchenginejournal.com', weight: 2 },
    { domain: 'moz.com', weight: 2 },
    { domain: 'ahrefs.com', weight: 2 },
    { domain: 'semrush.com', weight: 2 },
    { domain: 'hubspot.com', weight: 1 },
    { domain: 'developers.google.com', weight: 3 },
    { domain: 'support.google.com', weight: 3 },
    { domain: 'statista.com', weight: 2 },
  ],
  // Alimentation, cuisine, nutrition
  alimentation: [
    { domain: 'anses.fr', weight: 3 },
    { domain: 'mangerbouger.fr', weight: 3 },
    { domain: 'agriculture.gouv.fr', weight: 2 },
    { domain: 'efsa.europa.eu', weight: 2 },
    { domain: 'ciqual.anses.fr', weight: 2 },
    { domain: '60millions-mag.com', weight: 1 },
    { domain: 'quechoisir.org', weight: 1 },
  ],
  // Education, formation
  education: [
    { domain: 'education.gouv.fr', weight: 3 },
    { domain: 'onisep.fr', weight: 3 },
    { domain: 'etudiant.gouv.fr', weight: 2 },
    { domain: 'letudiant.fr', weight: 1 },
    { domain: 'eduscol.education.fr', weight: 2 },
    { domain: 'france-competences.fr', weight: 2 },
  ],
  // Consommation, comparatifs, avis
  consommation: [
    { domain: 'quechoisir.org', weight: 3 },
    { domain: '60millions-mag.com', weight: 3 },
    { domain: 'economie.gouv.fr', weight: 2 },
    { domain: 'signal.conso.gouv.fr', weight: 2 },
    { domain: 'inc-conso.fr', weight: 2 },
  ],
}

/**
 * Niche keyword mapping: maps common niche keywords to NICHE_AUTHORITY_DOMAINS keys.
 */
const NICHE_KEYWORD_MAP: Record<string, string[]> = {
  sante: ['sante', 'medical', 'bien-etre', 'maladie', 'medicament', 'nutrition', 'fitness', 'grossesse', 'sommeil'],
  environnement: ['environnement', 'ecologie', 'energie', 'climat', 'durable', 'renouvelable', 'carbone', 'recyclage'],
  habitat: ['habitat', 'maison', 'renovation', 'isolation', 'chauffage', 'pompe a chaleur', 'poele', 'construction', 'bricolage', 'immobilier', 'deco'],
  finance: ['finance', 'investissement', 'assurance', 'banque', 'credit', 'impot', 'epargne', 'bourse', 'crypto', 'patrimoine'],
  droit: ['droit', 'juridique', 'avocat', 'contrat', 'loi', 'litige', 'succession'],
  tech: ['tech', 'informatique', 'logiciel', 'application', 'intelligence artificielle', 'cybersecurite', 'cloud', 'developpement'],
  marketing: ['marketing', 'seo', 'referencement', 'publicite', 'emailing', 'content marketing', 'growth', 'conversion'],
  alimentation: ['alimentation', 'cuisine', 'recette', 'regime', 'bio', 'vegan', 'complement alimentaire'],
  education: ['education', 'formation', 'diplome', 'apprentissage', 'etude', 'concours', 'orientation'],
  consommation: ['comparatif', 'avis', 'meilleur', 'test', 'guide achat', 'consommation'],
}

/**
 * Detect the most relevant niche for a given keyword.
 */
function detectNiche(keyword: string, siteNiche?: string): string | null {
  const normalizedKw = keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const normalizedNiche = (siteNiche || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Check site niche first (direct match)
  for (const [nicheKey, keywords] of Object.entries(NICHE_KEYWORD_MAP)) {
    if (keywords.some(k => normalizedNiche.includes(k))) return nicheKey
  }

  // Then check article keyword
  for (const [nicheKey, keywords] of Object.entries(NICHE_KEYWORD_MAP)) {
    if (keywords.some(k => normalizedKw.includes(k))) return nicheKey
  }

  return null
}

/**
 * Check if a URL is an authority domain, with optional niche weighting.
 * Returns the authority weight (1-3) or 0 if not an authority.
 */
export function getAuthorityWeight(url: string, keyword?: string, siteNiche?: string): number {
  const urlLower = url.toLowerCase()

  // Check niche-specific domains first (higher weight)
  if (keyword || siteNiche) {
    const niche = detectNiche(keyword || '', siteNiche)
    if (niche && NICHE_AUTHORITY_DOMAINS[niche]) {
      const nicheMatch = NICHE_AUTHORITY_DOMAINS[niche].find(d => urlLower.includes(d.domain))
      if (nicheMatch) return nicheMatch.weight
    }
  }

  // Check general authority domains
  if (GENERAL_AUTHORITY_DOMAINS.some(p => urlLower.includes(p))) return 1

  return 0
}

/**
 * Check if a URL is an authority domain (boolean, backward-compatible).
 */
export function isAuthorityDomain(url: string, keyword?: string, siteNiche?: string): boolean {
  return getAuthorityWeight(url, keyword, siteNiche) > 0
}

/**
 * Get all authority domain patterns (general + niche-specific).
 * Used for backward compatibility with existing code.
 */
export function getAllAuthorityPatterns(keyword?: string, siteNiche?: string): string[] {
  const patterns = [...GENERAL_AUTHORITY_DOMAINS]

  if (keyword || siteNiche) {
    const niche = detectNiche(keyword || '', siteNiche)
    if (niche && NICHE_AUTHORITY_DOMAINS[niche]) {
      for (const d of NICHE_AUTHORITY_DOMAINS[niche]) {
        if (!patterns.includes(d.domain)) patterns.push(d.domain)
      }
    }
  }

  return patterns
}

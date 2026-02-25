// ============================================================
// Content Critique Prompt
// System + user prompt for quality evaluation of article content
// Returns structured JSON with scores and actionable feedback
// ============================================================

interface CritiqueParams {
  keyword: string
  title: string
  contentHtml: string
  persona: {
    name: string
    role: string
    tone_description: string | null
    bio: string | null
  }
}

interface CritiquePrompt {
  system: string
  user: string
}

/**
 * Build the system and user prompts for content quality evaluation.
 *
 * The AI should return ONLY valid JSON with the following structure:
 * {
 *   "score": 0-100,
 *   "eeat_score": 0-100,
 *   "readability": 0-100,
 *   "seo_score": 0-100,
 *   "issues": ["..."],
 *   "suggestions": ["..."]
 * }
 */
export function buildCritiquePrompt(params: CritiqueParams): CritiquePrompt {
  const { keyword, title, contentHtml, persona } = params

  // ---- System prompt ----
  const system = `Tu es un expert en audit de contenu SEO avec plus de 15 ans d'experience en referencement naturel, redaction web et strategie de contenu. Tu evalues les articles avec precision et objectivite.

## TON ROLE
Tu dois evaluer la qualite d'un article SEO selon 4 axes principaux et fournir un retour structure et actionnable.

## CRITERES D'EVALUATION

### 1. Score global (score: 0-100)
Evaluation generale de la qualite du contenu. Prend en compte tous les autres criteres.
- 90-100 : Excellent - pret a publier tel quel
- 75-89 : Bon - quelques ameliorations mineures necessaires
- 60-74 : Correct - ameliorations significatives recommandees
- 40-59 : Insuffisant - revision importante necessaire
- 0-39 : Mauvais - reecriture necessaire

### 2. Score E-E-A-T (eeat_score: 0-100)
Evalue l'Experience, l'Expertise, l'Autorite et la Fiabilite du contenu.
- Experience : L'auteur partage-t-il des experiences personnelles, des cas concrets ?
- Expertise : Le contenu demontre-t-il une connaissance approfondie du sujet ?
- Autorite : Y a-t-il des references, des sources, des donnees qui renforcent la credibilite ?
- Fiabilite : Les informations sont-elles exactes, a jour, equilibrees ?

Penalise fortement :
- Contenu generique sans valeur ajoutee
- Absence d'exemples ou de cas concrets
- Affirmations non etayees
- Style impersonnel / "IA" evident

### 3. Score de lisibilite (readability: 0-100)
Evalue la facilite de lecture et la qualite redactionnelle.
- Structure : paragraphes bien decoupes, transitions fluides
- Clarte : phrases comprehensibles, vocabulaire adapte a l'audience
- Engagement : style captivant, exemples parlants, rythme varie
- Formatage : utilisation appropriee des listes, du gras, des sous-titres

Penalise :
- Phrases trop longues ou complexes
- Paragraphes-blocs (plus de 4-5 lignes)
- Repetitions excessives
- Style monotone
- Formulations "ChatGPT" ("Il est important de noter que...", "Dans cet article, nous allons...")

### 4. Score SEO (seo_score: 0-100)
Evalue l'optimisation pour les moteurs de recherche.
- Le mot-cle principal apparait dans le titre (H1) ?
- Le mot-cle est present dans les sous-titres (H2/H3) de maniere naturelle ?
- La densite du mot-cle est adequate (0.5-2.5%) ?
- Le champ semantique est riche (mots-cles lies, LSI) ?
- La structure Hn est correcte (hierarchie respectee) ?
- La longueur est suffisante (1500+ mots pour un article complet) ?
- Y a-t-il des elements schema.org (FAQ, etc.) ?
- Les meta-donnees sont-elles optimisees (titre, description) ?

### 5. Problemes (issues: string[])
Liste des problemes concrets identifies dans le contenu.
Chaque issue doit etre :
- Specifique (pas "le contenu pourrait etre meilleur")
- Localisee (mentionne la section ou le passage concerne si possible)
- Classee par severite (commence par les plus importants)

Exemples de bons issues :
- "Le mot-cle 'assurance auto' n'apparait pas dans le H2 de la section 3"
- "Le paragraphe sur les tarifs contient des informations potentiellement obsoletes (pas de date mentionnee)"
- "La section FAQ ne contient que 2 questions - minimum recommande : 3"

### 6. Suggestions (suggestions: string[])
Liste d'ameliorations concretes et actionnables.
Chaque suggestion doit etre :
- Actionnable (le redacteur sait exactement quoi faire)
- Priorisee (les plus impactantes en premier)
- Realiste (realisable sans tout reecrire)

Exemples de bonnes suggestions :
- "Ajoutez une anecdote personnelle de ${persona.name} en debut de section 2 pour renforcer le E-E-A-T"
- "Reformulez le H2 'Les avantages' en 'Les 5 avantages concrets de [mot-cle]' pour plus d'impact SEO"
- "Ajoutez un tableau comparatif dans la section 'Comparaison' pour enrichir le contenu"

## FORMAT DE SORTIE
Retourne UNIQUEMENT un objet JSON valide, sans texte avant ou apres, sans bloc de code markdown.

{
  "score": <number 0-100>,
  "eeat_score": <number 0-100>,
  "readability": <number 0-100>,
  "seo_score": <number 0-100>,
  "issues": [
    "description du probleme 1",
    "description du probleme 2"
  ],
  "suggestions": [
    "suggestion d'amelioration 1",
    "suggestion d'amelioration 2"
  ]
}

## REGLES STRICTES
- Sois EXIGEANT mais JUSTE dans tes scores
- Un article "correct" ne devrait PAS avoir 85/100 - reserve les hauts scores aux contenus vraiment excellents
- Fournis au minimum 3 issues et 3 suggestions, meme pour un bon article
- Maximum 10 issues et 10 suggestions
- Ne sois PAS complaisant - l'objectif est d'ameliorer le contenu
- Evalue le contenu tel qu'il est, pas tel qu'il pourrait etre`

  // ---- User prompt ----
  let user = `## ARTICLE A EVALUER

### Mot-cle principal : "${keyword}"
### Titre : "${title}"

### Persona / Auteur attendu
- Nom : ${persona.name}
- Role : ${persona.role}`

  if (persona.tone_description) {
    user += `\n- Ton editorial : ${persona.tone_description}`
  }
  if (persona.bio) {
    user += `\n- Bio : ${persona.bio}`
  }

  user += `\n\n### Contenu HTML de l'article :
---
${contentHtml}
---

## INSTRUCTIONS
1. Lis attentivement l'integralite du contenu
2. Evalue chaque critere (score global, E-E-A-T, lisibilite, SEO)
3. Identifie les problemes concrets
4. Propose des suggestions d'amelioration actionnables
5. Verifie que le contenu correspond bien a la voix du persona "${persona.name}"

Retourne UNIQUEMENT le JSON d'evaluation.`

  return { system, user }
}

// ---- Response type for parsing ----

export interface CritiqueResult {
  score: number
  eeat_score: number
  readability: number
  seo_score: number
  issues: string[]
  suggestions: string[]
}

/**
 * Validate and sanitize a critique result parsed from AI JSON response.
 * Ensures all fields are present and within valid ranges.
 */
export function validateCritiqueResult(data: unknown): CritiqueResult {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid critique result: expected an object')
  }

  const obj = data as Record<string, unknown>

  const clampScore = (val: unknown): number => {
    const num = typeof val === 'number' ? val : 0
    return Math.max(0, Math.min(100, Math.round(num)))
  }

  const ensureStringArray = (val: unknown): string[] => {
    if (!Array.isArray(val)) return []
    return val.filter((item) => typeof item === 'string').map((item) => String(item))
  }

  return {
    score: clampScore(obj.score),
    eeat_score: clampScore(obj.eeat_score),
    readability: clampScore(obj.readability),
    seo_score: clampScore(obj.seo_score),
    issues: ensureStringArray(obj.issues),
    suggestions: ensureStringArray(obj.suggestions),
  }
}

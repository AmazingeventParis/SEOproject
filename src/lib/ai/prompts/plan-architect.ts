// ============================================================
// Plan Architect Prompt
// System + user prompt for generating structured article plans
// Returns ONLY valid JSON with article outline
// ============================================================

interface PlanArchitectParams {
  keyword: string
  searchIntent: string
  persona: {
    name: string
    role: string
    tone_description: string | null
    bio: string | null
  }
  serpData?: {
    organic: { position: number; title: string; snippet: string; domain: string }[]
    peopleAlsoAsk: { question: string }[]
    relatedSearches: { query: string }[]
  }
  nuggets: { id: string; content: string; tags: string[] }[]
  existingSiloArticles?: { title: string | null; keyword: string; slug: string | null }[]
}

interface PlanArchitectPrompt {
  system: string
  user: string
}

/**
 * Build the system and user prompts for the Plan Architect AI task.
 *
 * The AI should return ONLY valid JSON with the following structure:
 * {
 *   "title": "...",
 *   "meta_description": "...",
 *   "slug": "...",
 *   "content_blocks": [
 *     {
 *       "id": "uuid",
 *       "type": "h2" | "h3" | "paragraph" | "list" | "faq",
 *       "heading": "...",
 *       "content_html": "",
 *       "nugget_ids": [],
 *       "word_count": 300,
 *       "status": "pending"
 *     }
 *   ]
 * }
 */
export function buildPlanArchitectPrompt(
  params: PlanArchitectParams
): PlanArchitectPrompt {
  const { keyword, searchIntent, persona, serpData, nuggets, existingSiloArticles } = params

  // ---- System prompt ----
  const system = `Tu es un architecte de contenu SEO expert, specialise dans la creation de plans d'articles optimises pour le referencement naturel Google.

## TON ROLE
Tu generes des plans d'articles structures, complets et optimises SEO. Tu dois produire un plan qui permettra a un redacteur de creer un contenu de haute qualite qui se positionnera en premiere page Google.

## REGLES SEO FONDAMENTALES

### Structure Hn (hierarchie des titres)
- Le H1 (title) doit contenir le mot-cle principal de maniere naturelle
- Utilise 3 a 6 sections H2 pour structurer l'article
- Chaque H2 peut avoir 1 a 3 sous-sections H3
- Les H2/H3 doivent integrer des variantes du mot-cle et des mots-cles secondaires
- Ne saute JAMAIS un niveau de titre (pas de H3 sans H2 parent)

### Optimisation E-E-A-T (Experience, Expertise, Autorite, Fiabilite)
- Integre des elements qui demontrent l'EXPERIENCE reelle du persona (anecdotes, cas concrets)
- Montre l'EXPERTISE avec des donnees precises, des definitions claires, des analyses approfondies
- Renforce l'AUTORITE en citant des sources, en faisant reference a des etudes
- Assure la FIABILITE avec des informations a jour, des avertissements quand necessaire

### Intention de recherche
- Adapte la structure au type d'intention de recherche :
  - "informational" / "traffic" : guide complet, tutoriel, explication detaillee
  - "commercial" / "comparison" / "review" : comparatif, avantages/inconvenients, tableaux
  - "transactional" / "lead_gen" : page orientee conversion, CTA, benefices
  - "discover" : contenu exploratoire, tendances, nouveautes

### Contenu
- Vise entre 1500 et 3000 mots au total (somme des word_count de chaque bloc)
- Chaque bloc doit avoir un word_count realiste (150-500 mots par bloc)
- Inclus TOUJOURS une section FAQ basee sur les questions "People Also Ask" si disponibles
- La FAQ doit avoir entre 3 et 6 questions pertinentes
- Prevois des blocs de type "list" pour les elements enumeratifs (avantages, etapes, etc.)

### Nuggets (contenus authentiques du persona)
- Si des nuggets sont fournis, assigne-les aux blocs les plus pertinents via nugget_ids
- Les nuggets apportent authenticite et E-E-A-T - utilise-les strategiquement
- Ne force pas l'utilisation de nuggets non pertinents

### Maillage interne (silo)
- Si des articles existants du meme silo sont fournis, prevois des opportunites de liens internes
- Mentionne dans les headings ou descriptions les sujets connexes qui pourraient etre lies

## FORMAT DE SORTIE
Tu DOIS retourner UNIQUEMENT un objet JSON valide, sans texte avant ou apres, sans bloc de code markdown.

Structure exacte attendue :
{
  "title": "Titre H1 optimise SEO (50-65 caracteres ideal)",
  "meta_description": "Meta description engageante (140-160 caracteres)",
  "slug": "url-slug-optimise",
  "content_blocks": [
    {
      "id": "genere un UUID v4 unique pour chaque bloc",
      "type": "h2 | h3 | paragraph | list | faq",
      "heading": "Titre de la section (pour h2, h3, faq) ou null pour paragraph/list",
      "content_html": "",
      "nugget_ids": ["ids des nuggets a integrer dans ce bloc"],
      "word_count": 300,
      "status": "pending"
    }
  ]
}

IMPORTANT :
- Le champ "content_html" doit TOUJOURS etre une chaine vide "" (le contenu sera genere ensuite)
- Le champ "status" doit TOUJOURS etre "pending"
- Genere de vrais UUID v4 pour chaque "id" (format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
- Le slug doit etre en minuscules, sans accents, avec des tirets
- La meta_description doit inciter au clic et contenir le mot-cle principal`

  // ---- User prompt ----
  let user = `## MISSION
Cree un plan d'article complet et optimise SEO pour le mot-cle suivant.

## MOT-CLE PRINCIPAL
"${keyword}"

## INTENTION DE RECHERCHE
${searchIntent}

## PERSONA / AUTEUR
- Nom : ${persona.name}
- Role : ${persona.role}`

  if (persona.tone_description) {
    user += `\n- Ton editorial : ${persona.tone_description}`
  }
  if (persona.bio) {
    user += `\n- Bio : ${persona.bio}`
  }

  // Add SERP data if available
  if (serpData) {
    user += `\n\n## DONNEES SERP (Top resultats Google actuels)`

    if (serpData.organic.length > 0) {
      user += `\n\n### Top resultats organiques :`
      for (const result of serpData.organic.slice(0, 10)) {
        user += `\n${result.position}. "${result.title}" (${result.domain})`
        user += `\n   Snippet: ${result.snippet}`
      }
    }

    if (serpData.peopleAlsoAsk.length > 0) {
      user += `\n\n### Questions "People Also Ask" (a integrer dans la FAQ) :`
      for (const paa of serpData.peopleAlsoAsk) {
        user += `\n- ${paa.question}`
      }
    }

    if (serpData.relatedSearches.length > 0) {
      user += `\n\n### Recherches associees (mots-cles secondaires potentiels) :`
      for (const rs of serpData.relatedSearches) {
        user += `\n- ${rs.query}`
      }
    }
  }

  // Add nuggets if available
  if (nuggets.length > 0) {
    user += `\n\n## NUGGETS DISPONIBLES (contenus authentiques du persona)
Assigne les nuggets pertinents aux blocs via leur ID dans nugget_ids.`

    for (const nugget of nuggets) {
      user += `\n\n### Nugget [${nugget.id}]`
      user += `\nTags: ${nugget.tags.join(', ') || 'aucun'}`
      user += `\nContenu: "${nugget.content}"`
    }
  }

  // Add existing silo articles if available
  if (existingSiloArticles && existingSiloArticles.length > 0) {
    user += `\n\n## ARTICLES EXISTANTS DANS LE MEME SILO
Prevois des opportunites de maillage interne avec ces articles :`

    for (const article of existingSiloArticles) {
      user += `\n- "${article.title || article.keyword}" (/${article.slug || ''})`
    }
  }

  user += `\n\n## INSTRUCTIONS FINALES
1. Analyse les resultats SERP pour comprendre ce qui fonctionne actuellement
2. Cree un plan qui surpasse les contenus existants en profondeur et en valeur
3. Integre les questions PAA dans une section FAQ dediee
4. Assigne les nuggets pertinents aux blocs appropriss
5. Assure-toi que le titre (H1) et la meta description sont optimises
6. Vise un total de 1500-3000 mots repartis de maniere equilibree

Retourne UNIQUEMENT le JSON, rien d'autre.`

  return { system, user }
}

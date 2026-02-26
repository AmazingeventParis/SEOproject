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
    writing_style_examples: Record<string, unknown>[]
  }
  serpData?: {
    organic: { position: number; title: string; snippet: string; domain: string }[]
    peopleAlsoAsk: { question: string }[]
    relatedSearches: { query: string }[]
  }
  nuggets: { id: string; content: string; tags: string[] }[]
  existingSiloArticles?: { title: string | null; keyword: string; slug: string | null }[]
  moneyPage?: { url: string; description: string } | null
  competitorContent?: {
    avgWordCount: number
    commonHeadings: string[]
    tfidfKeywords: { term: string; tfidf: number; df: number }[]
  }
  semanticAnalysis?: {
    contentGaps: string[]
    semanticField: string[]
    recommendedWordCount: number
    recommendedH2Structure: string[]
    keyDifferentiators: string[]
    mustAnswerQuestions: string[]
  }
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
 *       "status": "pending",
 *       "writing_directive": "...",
 *       "format_hint": "prose" | "bullets" | "table" | "mixed",
 *       "generate_image": true | false,
 *       "image_prompt_hint": "..."
 *     }
 *   ]
 * }
 */
export function buildPlanArchitectPrompt(
  params: PlanArchitectParams
): PlanArchitectPrompt {
  const { keyword, searchIntent, persona, serpData, nuggets, existingSiloArticles, moneyPage, competitorContent, semanticAnalysis } = params

  // ---- System prompt ----
  const system = `Tu es un architecte de contenu SEO expert, specialise dans la creation de plans d'articles optimises pour le referencement naturel Google. Tu produis des plans qui rankent ET qui sont utiles a lire.

## TON ROLE
Tu generes des plans d'articles structures en PYRAMIDE INVERSEE, complets et optimises SEO. Le plan doit permettre a un redacteur de creer un contenu de haute qualite qui se positionnera en premiere page Google.

## STRUCTURE PYRAMIDE INVERSEE (OBLIGATOIRE)

### Principe fondamental
L'article doit repondre a l'intention de recherche DES LE PREMIER H2. Le lecteur obtient la reponse immediatement, puis chaque section approfondit ou elargit le sujet.

### Ordre des sections
1. **Premier H2** : Repond DIRECTEMENT a l'intention de recherche (la reponse, le comparatif, la solution)
2. **H2 suivants** : Approfondissent, detaillent, donnent des cas concrets
3. **Avant-dernier H2** : Section optionnelle (erreurs a eviter, conseils avances, etc.)
4. **Dernier bloc** : FAQ (si PAA disponibles)

### INTERDIT en premier H2
- "Qu'est-ce que..." / "Definition de..."
- "Introduction a..."
- "Contexte de..."
- "Historique de..."
Ces elements peuvent apparaitre en H3 sous un H2 pertinent, mais JAMAIS en ouverture d'article.

## Hn SEMANTIQUES (TITRES OPTIMISES)

### Regles H2
- Chaque H2 doit etre une QUESTION ou une PROMESSE claire (pas de titres vagues)
- Chaque H2 doit etre comprehensible DE FACON ISOLEE (pense featured snippet Google)
- Integre des mots-cles secondaires naturellement dans les H2
- 3 a 6 sections H2 par article
- Exemples BONS : "Quel budget prevoir pour une renovation de salle de bain ?"
- Exemples MAUVAIS : "Le budget", "Parlons argent", "Introduction"

### Regles H3
- Chaque H3 = sous-aspect CONCRET du H2 parent
- 1 a 3 H3 par H2 maximum
- Les H3 doivent integrer des variantes du mot-cle
- Ne saute JAMAIS un niveau (pas de H3 sans H2 parent)

## DIRECTIVES D'ECRITURE PAR BLOC (OBLIGATOIRE)

Chaque bloc DOIT avoir :
- **writing_directive** : 1-2 phrases expliquant COMMENT maximiser la transmission d'info pour ce bloc specifique. Ex: "Presente sous forme de tableau comparatif 3 colonnes : critere, option A, option B. Ajoute une phrase d'intro."
- **format_hint** : le format recommande parmi 'prose', 'bullets', 'table', 'mixed'

### Regles de choix du format_hint
- **'table'** : si la section compare >2 elements OU liste >4 criteres avec des donnees structurees
- **'bullets'** : si la section enumere des etapes, avantages, inconvenients, ou une liste d'elements
- **'mixed'** : si la section necessite du contexte narratif + un element visuel (tableau ou liste)
- **'prose'** : pour les sections narratives, analytiques, ou explicatives

## DECISION IMAGE PAR H2 (OBLIGATOIRE)

Pour chaque bloc de type H2, tu DOIS decider si une illustration est pertinente :
- **generate_image: true** : pour les sections qui beneficient d'un visuel (concepts abstraits, processus, produits, avant/apres)
- **generate_image: false** : pour les FAQ, les tableaux de comparaison purs, les listes simples
- Si true, fournis **image_prompt_hint** : description de la scene/concept a illustrer (en anglais, style photo editoriale)

## OPTIMISATION E-E-A-T
- Integre des elements montrant l'EXPERIENCE reelle du persona (anecdotes, cas concrets)
- Montre l'EXPERTISE avec des donnees precises, des analyses approfondies
- Renforce l'AUTORITE en citant des sources, des etudes
- Assure la FIABILITE avec des informations a jour

## INTENTION DE RECHERCHE
Adapte la structure au type d'intention :
- "informational" / "traffic" : guide complet, tutoriel, explication detaillee
- "commercial" / "comparison" / "review" : comparatif, tableaux, avantages/inconvenients
- "transactional" / "lead_gen" : page conversion, CTA, benefices
- "discover" : contenu exploratoire, tendances, nouveautes

## CONTENU
- Vise entre 1500 et 3000 mots au total (somme des word_count)
- Chaque bloc : 150-500 mots
- TOUJOURS une section FAQ basee sur les "People Also Ask" (3-6 questions)
- Blocs "list" pour les elements enumeratifs

## NUGGETS (contenus authentiques du persona)
- Assigne les nuggets pertinents via nugget_ids
- Ne force pas les nuggets non pertinents

## ANALYSE CONCURRENTIELLE (si disponible)
- Couvre TOUS les H2 communs des concurrents
- Integre les termes TF-IDF naturellement
- Comble les lacunes de contenu (content gaps)
- Depasse la moyenne de mots des concurrents de 20%+
- Traite les questions incontournables dans le contenu ou la FAQ

## MAILLAGE INTERNE STRATEGIQUE

Pour chaque bloc H2, definis "internal_link_targets" (tableau, peut etre vide []).

Regles :
- Chaque entree : { "target_slug", "target_title", "suggested_anchor_context", "is_money_page" }
- "suggested_anchor_context" = indication sur COMMENT integrer le lien naturellement
- Un meme target_slug ne peut apparaitre qu'1 fois dans tout l'article
- Max 2-3 liens internes par H2 (pas de sur-optimisation)
- Place les liens la ou c'est NATUREL par rapport au sujet de la section
- L'ancre finale sera decidee par le redacteur — donne juste le contexte d'insertion

## SUGGESTIONS DE TITRE H1 (OBLIGATOIRE)

Tu DOIS proposer exactement 3 variantes de titre H1, chacune avec une strategie differente :
1. **Question** : formule le titre comme une question (cible le featured snippet Google)
2. **Promesse** : formule le titre comme une promesse de valeur claire pour le lecteur
3. **Specifique** : utilise des chiffres, donnees concretes ou l'annee en cours

Chaque suggestion doit inclure :
- "title" : le titre H1 (50-65 caracteres ideal)
- "slug" : le slug URL correspondant (minuscules, sans accents, tirets)
- "seo_rationale" : 1 phrase expliquant pourquoi ce titre est optimise SEO

## FORMAT DE SORTIE
Tu DOIS retourner UNIQUEMENT un objet JSON valide, sans texte avant ou apres, sans bloc de code markdown.

{
  "title_suggestions": [
    {
      "title": "Titre variante Question (cible featured snippet)",
      "slug": "slug-question",
      "seo_rationale": "Explication SEO"
    },
    {
      "title": "Titre variante Promesse (valeur lecteur)",
      "slug": "slug-promesse",
      "seo_rationale": "Explication SEO"
    },
    {
      "title": "Titre variante Specifique (chiffres/annee)",
      "slug": "slug-specifique",
      "seo_rationale": "Explication SEO"
    }
  ],
  "meta_description": "Meta description engageante (140-160 caracteres)",
  "content_blocks": [
    {
      "id": "genere un UUID v4 unique",
      "type": "h2 | h3 | paragraph | list | faq",
      "heading": "Titre de la section (pour h2, h3, faq) ou null",
      "content_html": "",
      "nugget_ids": ["ids des nuggets"],
      "word_count": 300,
      "status": "pending",
      "writing_directive": "Directive d'ecriture specifique pour ce bloc",
      "format_hint": "prose | bullets | table | mixed",
      "generate_image": true,
      "image_prompt_hint": "Editorial photo showing...",
      "internal_link_targets": [
        {
          "target_slug": "slug-de-larticle-cible",
          "target_title": "Titre de l'article cible",
          "suggested_anchor_context": "Comment integrer le lien naturellement dans cette section",
          "is_money_page": false
        }
      ]
    }
  ]
}

IMPORTANT :
- "title_suggestions" doit contenir EXACTEMENT 3 suggestions avec 3 strategies differentes (question, promesse, specifique)
- "content_html" doit TOUJOURS etre "" (le contenu sera genere ensuite)
- "status" doit TOUJOURS etre "pending"
- Genere de vrais UUID v4 pour chaque "id" (format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
- Les slugs doivent etre en minuscules, sans accents, avec des tirets
- La meta_description doit inciter au clic et contenir le mot-cle principal
- "writing_directive" est OBLIGATOIRE sur chaque bloc
- "format_hint" est OBLIGATOIRE sur chaque bloc
- "generate_image" est OBLIGATOIRE sur les blocs de type "h2" (false pour les autres types)
- "image_prompt_hint" est requis uniquement si generate_image est true
- "internal_link_targets" est OBLIGATOIRE sur les blocs de type "h2" (tableau vide [] si aucun lien pertinent)`

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

  // Add writing style examples if available
  if (persona.writing_style_examples && persona.writing_style_examples.length > 0) {
    user += `\n\n## STYLE D'ECRITURE DU PERSONA (exemples reels)
Voici des extraits authentiques de ${persona.name}. Adapte la structure du plan au niveau d'expertise et au style de ce persona :`
    for (const example of persona.writing_style_examples.slice(0, 3)) {
      const text = (example as Record<string, unknown>).text || (example as Record<string, unknown>).content || JSON.stringify(example)
      user += `\n\n> ${String(text).slice(0, 500)}`
    }
    user += `\n\nTiens compte de ce style pour :
- Le niveau de technicite des H2/H3 (vocabulaire adapte au persona)
- Le type de contenu privilegie (analytique, pratique, narratif, etc.)
- La densite d'information par section (word_count adapte)`
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

  // Add money page if configured
  if (moneyPage) {
    user += `\n\n## PAGE PRIORITAIRE (MONEY PAGE)
URL : ${moneyPage.url}
Description : ${moneyPage.description}
Tu DOIS placer un lien vers cette page dans 1 a 2 sections H2 pertinentes.
Marque ces entrees avec "is_money_page": true dans internal_link_targets.`
  }

  // Add competitor content analysis if available
  if (competitorContent || semanticAnalysis) {
    user += `\n\n## ANALYSE APPROFONDIE DES CONCURRENTS`

    if (competitorContent) {
      user += `\n\n### Metriques du contenu concurrent`
      user += `\n- Nombre de mots moyen : ${competitorContent.avgWordCount}`

      if (competitorContent.commonHeadings.length > 0) {
        user += `\n\n### H2 recurrents chez les concurrents :`
        for (const heading of competitorContent.commonHeadings) {
          user += `\n- ${heading}`
        }
      }

      if (competitorContent.tfidfKeywords.length > 0) {
        user += `\n\n### Termes TF-IDF les plus importants (top 20) :`
        for (const term of competitorContent.tfidfKeywords.slice(0, 20)) {
          user += `\n- "${term.term}" (score: ${term.tfidf.toFixed(4)}, ${term.df} pages)`
        }
      }
    }

    if (semanticAnalysis) {
      if (semanticAnalysis.contentGaps.length > 0) {
        user += `\n\n### Lacunes de contenu a combler :`
        for (const gap of semanticAnalysis.contentGaps) {
          user += `\n- ${gap}`
        }
      }

      if (semanticAnalysis.semanticField.length > 0) {
        user += `\n\n### Champ semantique a integrer :`
        user += `\n${semanticAnalysis.semanticField.join(', ')}`
      }

      if (semanticAnalysis.recommendedH2Structure.length > 0) {
        user += `\n\n### Structure H2 recommandee :`
        for (const h2 of semanticAnalysis.recommendedH2Structure) {
          user += `\n- ${h2}`
        }
      }

      if (semanticAnalysis.keyDifferentiators.length > 0) {
        user += `\n\n### Angles differenciateurs :`
        for (const diff of semanticAnalysis.keyDifferentiators) {
          user += `\n- ${diff}`
        }
      }

      if (semanticAnalysis.mustAnswerQuestions.length > 0) {
        user += `\n\n### Questions incontournables :`
        for (const q of semanticAnalysis.mustAnswerQuestions) {
          user += `\n- ${q}`
        }
      }

      if (semanticAnalysis.recommendedWordCount) {
        user += `\n\n### Nombre de mots recommande : ${semanticAnalysis.recommendedWordCount}`
      }
    }
  }

  user += `\n\n## INSTRUCTIONS FINALES
1. PYRAMIDE INVERSEE : le premier H2 repond DIRECTEMENT a l'intention de recherche
2. Hn SEMANTIQUES : chaque H2 est une question ou promesse claire, comprehensible isolement
3. WRITING DIRECTIVES : chaque bloc a une directive d'ecriture specifique et un format_hint
4. IMAGES : decide pour chaque H2 si une image est pertinente (generate_image + image_prompt_hint)
5. Analyse les SERP pour surpasser les contenus existants en profondeur et en valeur
6. Integre les questions PAA dans une section FAQ dediee
7. Assigne les nuggets pertinents aux blocs appropries
8. Propose 3 variantes de titre H1 (question, promesse, specifique) + meta description optimisee
9. Vise 1500-3000 mots repartis equilibrement

Retourne UNIQUEMENT le JSON, rien d'autre.`

  return { system, user }
}

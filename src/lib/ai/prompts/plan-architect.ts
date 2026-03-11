// ============================================================
// Plan Architect Prompt
// System + user prompt for generating structured article plans
// Returns ONLY valid JSON with article outline
// ============================================================

import {
  SEO_EEAT_RULES,
  SEO_FAQ_RULES,
  SEO_HEADING_STRUCTURE_RULES,
  SEO_INTERNAL_LINKING_RULES,
  INTENT_STRATEGIES,
} from './seo-guidelines'

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
  nuggets: { id: string; content: string; tags: string[]; source_type?: string }[]
  existingSiloArticles?: { title: string | null; keyword: string; slug: string | null }[]
  moneyPage?: { url: string; description: string } | null
  competitorContent?: {
    avgWordCount: number
    commonHeadings: string[]
    tfidfKeywords: { term: string; tfidf: number; df: number }[]
  }
  semanticAnalysis?: {
    contentGaps: (string | { label: string; type: string; description: string })[]
    semanticField: string[]
    recommendedWordCount: number
    recommendedH2Structure: string[]
    keyDifferentiators: string[]
    mustAnswerQuestions: string[]
  }
  selectedContentGaps?: string[]
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
 *       "type": "h2" | "h3" | "h4" | "paragraph" | "list" | "faq",
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
  const { keyword, searchIntent, persona, serpData, nuggets, existingSiloArticles, moneyPage, competitorContent, semanticAnalysis, selectedContentGaps } = params

  const currentYear = new Date().getFullYear()

  // ---- System prompt ----
  const system = `Tu es un architecte de contenu SEO expert, specialise dans la creation de plans d'articles optimises pour le referencement naturel Google. Tu produis des plans qui rankent ET qui sont utiles a lire.

## ANNEE EN COURS : ${currentYear}
REGLE ABSOLUE : nous sommes en ${currentYear}. Si un titre, un seo_title, un slug, un contenu ou une meta_description mentionne une annee, ce DOIT etre ${currentYear}. JAMAIS 2024 ou 2025. C'est non negociable.

## TON ROLE
Tu generes des plans d'articles structures en PYRAMIDE INVERSEE, complets et optimises SEO. Le plan doit permettre a un redacteur de creer un contenu de haute qualite qui se positionnera en premiere page Google.

## CONTRAINTE MECE (Mutuellement Exclusif, Collectivement Exhaustif)

REGLE ABSOLUE : le plan doit etre MECE.
- **Mutuellement Exclusif** : aucune idee, argument, exemple ou conseil ne doit se chevaucher entre deux sections. Si un point est traite dans le H2 "Choix des materiaux", il est INTERDIT de le rementionner dans "Mise en oeuvre". Chaque section a un PERIMETRE ETANCHE.
- **Collectivement Exhaustif** : l'ensemble des sections couvre TOUT ce que le lecteur doit savoir sur le sujet. Aucun angle important ne manque.

Pour chaque bloc, tu DOIS definir "key_ideas" : un tableau de 3-5 idees cles qui seront traitees UNIQUEMENT dans cette section. Ce perimetre est exclusif — aucune autre section ne traitera ces idees.

## STRUCTURE PYRAMIDE INVERSEE (OBLIGATOIRE)

### Principe fondamental
L'article doit repondre a l'intention de recherche DES LE PREMIER H2. Le lecteur obtient la reponse immediatement, puis chaque section approfondit ou elargit le sujet.

### Ordre des sections
0. **Bloc intro (OBLIGATOIRE)** : type "paragraph", heading null, 100-140 mots. Contient le mot-cle principal. AVANT le premier H2. Ce bloc doit :
   - Valider que le lecteur est au bon endroit (identification du persona cible)
   - Contenir une phrase explicite de validation d'intention : ce que le lecteur va apprendre ou resoudre
   - Phrases courtes, percutantes, zero fluff. Une idee par phrase.
   - Pas de formules generiques ("Depuis la nuit des temps...", "Il est important de...")
1. **Premier H2** : Repond DIRECTEMENT a l'intention de recherche (la reponse, le comparatif, la solution)
2. **H2 suivants** : Approfondissent, detaillent, donnent des cas concrets
3. **Avant-dernier H2** : Section optionnelle (erreurs a eviter, conseils avances, etc.)
4. **Dernier bloc (optionnel)** : FAQ (si PAA disponibles et pertinent pour l'intention)

### INTERDIT en premier H2
- "Qu'est-ce que..." / "Definition de..."
- "Introduction a..."
- "Contexte de..."
- "Historique de..."
Ces elements peuvent apparaitre en H3 sous un H2 pertinent, mais JAMAIS en ouverture d'article.

## Hn SEMANTIQUES (TITRES OPTIMISES) — SIGNAL SEO N°1

Les Hn sont les balises les plus lues par Google pour comprendre le contenu. Un H2 vague ou generique = un signal perdu = une position perdue. Chaque H2/H3 est une OPPORTUNITE SEMANTIQUE.

${SEO_HEADING_STRUCTURE_RULES}

### Checklist de validation OBLIGATOIRE (a verifier pour CHAQUE H2 avant de valider le plan)
1. Le H2 contient-il le mot-cle principal OU un terme semantique/TF-IDF du domaine ? Si NON → reformule
2. Le H2 pourrait-il etre un featured snippet Google ? Si NON → reformule en question ou promesse concrete
3. Le H2 apporte-t-il un signal semantique DIFFERENT des autres H2 ? Si doublon semantique → fusionne ou reformule
4. Le H2 fait-il moins de 80 caracteres ? Si NON → condense
5. Le H2 est-il specifique (chiffre, annee, comparaison, nom precis) ? Si trop vague → ajoute un qualificateur

## DIRECTIVES D'ECRITURE PAR BLOC (OBLIGATOIRE)

Chaque bloc DOIT avoir :
- **writing_directive** : 1-2 phrases expliquant COMMENT maximiser la transmission d'info pour ce bloc specifique. Ex: "Presente sous forme de tableau comparatif 3 colonnes : critere, option A, option B. Ajoute une phrase d'intro."
- **format_hint** : le format recommande parmi 'prose', 'bullets', 'table', 'mixed'

### Regles de choix du format_hint
- **'table'** : si la section compare >2 elements OU liste >4 criteres avec des donnees structurees
- **'bullets'** : si la section enumere des etapes, avantages, inconvenients, ou une liste d'elements
- **'mixed'** : si la section necessite du contexte narratif + un element visuel (tableau ou liste)
- **'prose'** : pour les sections narratives, analytiques, ou explicatives

## DECISION IMAGE (OBLIGATOIRE — MINIMUM 5 IMAGES, AUCUNE EXCEPTION)

Les images sont essentielles pour la lisibilite et le SEO. Regles STRICTES :
- **REGLE N°1 (NON NEGOCIABLE)** : le PREMIER bloc H2 DOIT avoir **generate_image: true**. Apres l'intro + la premiere section, le lecteur a besoin d'une respiration visuelle.
- **REGLE N°2 (NON NEGOCIABLE)** : au moins **5 blocs H2/H3** doivent avoir **generate_image: true**. Si l'article a 6+ sections, monte a 6-7 images. Un article avec moins de 5 images est REFUSE.
- **generate_image: false** : UNIQUEMENT pour la FAQ et les blocs de moins de 100 mots
- Si true, fournis **image_prompt_hint** : description de la scene/concept a illustrer (en anglais, style photo editoriale)
- Repartis les images de facon equilibree dans l'article (pas 3 images d'affilee puis plus rien)

## OPTIMISATION E-E-A-T
${SEO_EEAT_RULES}

## STRATEGIE — Intention "${searchIntent}"
${INTENT_STRATEGIES[searchIntent]?.plan || 'Structure guide complet standard.'}

Tu DOIS respecter cette strategie de structure. L'intention de recherche determine TOUT : le nombre de mots, l'ordre des sections, les formats de blocs, et la presence ou non d'une FAQ.

## DECOUPE H3 DES SECTIONS LONGUES (OBLIGATOIRE)

Si une section H2 couvre un sujet large qui necessite plus de 400 mots, tu DOIS la decouper en sous-sections H3 :
- Chaque H3 traite un aspect specifique du sujet du H2 parent
- 2-4 H3 par H2 maximum
- Le H2 reste le "chapeau" thematique, les H3 approfondissent
- Chaque H3 : 150-300 mots
- Les H3 ont leur propre writing_directive et format_hint
- Exemple : H2 "Les meilleurs outils SEO" → H3 "Outils de recherche de mots-cles", H3 "Outils d'analyse technique", H3 "Outils de suivi de positionnement"

NE DECOUPE PAS en H3 si la section H2 est courte (<300 mots) ou si le sujet est unitaire.

## WORD COUNT PAR BLOC — REGLE STRICTE (CRITIQUE)

⚠️ Le word_count de chaque bloc est le NOMBRE DE MOTS que le redacteur devra ecrire. Ce n'est PAS un nombre de caracteres.
Un paragraphe de 200 mots fait environ 8-10 lignes de texte. 50 mots = 2 lignes = BEAUCOUP TROP COURT.

MINIMUMS ABSOLUS (jamais en dessous) :
- Bloc intro (paragraph, heading null) : word_count = 120 (100-140 mots)
- Bloc H2 SANS sous-sections H3 : word_count entre 250 et 500 (MINIMUM 250)
- Bloc H3 : word_count entre 150 et 300 (MINIMUM 150)
- Bloc FAQ : word_count entre 300 et 600 (MINIMUM 300, chaque Q/R = 40-80 mots)
- Bloc list : word_count entre 200 et 400 (MINIMUM 200)

INTERDIT : un word_count inferieur a 120 sur un bloc de contenu (sauf intro). Si tu generes un bloc H2 avec word_count de 50 ou 80, c'est une ERREUR GRAVE.

TOTAL ARTICLE : respecte la fourchette indiquee dans la strategie (typiquement 1500-3000 mots). La SOMME de tous les word_count doit etre dans cette fourchette.

## CONTENU
- Respecte la fourchette de mots indiquee dans la strategie ci-dessus
- Section FAQ (optionnelle) avec le heading "FAQ" en type "faq". Ne l'inclus PAS si la strategie l'interdit (ex: discover). L'utilisateur pourra l'ajouter manuellement plus tard si besoin.
${SEO_FAQ_RULES}
- Blocs "list" pour les elements enumeratifs

## NUGGETS (contenus authentiques du persona)
- Assigne les nuggets pertinents via nugget_ids
- Ne force pas les nuggets non pertinents

## ANALYSE CONCURRENTIELLE (si disponible)
- Couvre TOUS les H2 communs des concurrents — mais reformule-les pour etre MEILLEURS (plus specifiques, avec mot-cle, avec qualificateur chiffre)
- **Termes TF-IDF dans les Hn** : les termes TF-IDF a score eleve indiquent les mots que Google associe au sujet. Integre les top 5-10 termes dans tes H2/H3 quand c'est naturel (ex: si "rendement" est un terme TF-IDF pour "poele de masse", un H2 pourrait etre "Quel rendement attendre d'un poele de masse ?")
- Comble les lacunes de contenu (content gaps)
- Depasse la moyenne de mots des concurrents de 20%+
- Traite les questions incontournables dans le contenu ou la FAQ
- **Questions PAA en H2/H3** : si une question PAA correspond a un angle de section, utilise-la directement comme H2 ou H3 (c'est ce que les utilisateurs tapent reellement)

## MAILLAGE INTERNE STRATEGIQUE

Pour chaque bloc H2, definis "internal_link_targets" (tableau, peut etre vide []).

${SEO_INTERNAL_LINKING_RULES}

Format par entree :
- Chaque entree : { "target_slug", "target_title", "suggested_anchor_context", "is_money_page" }
- "suggested_anchor_context" = indication sur COMMENT integrer le lien naturellement
- L'ancre finale sera decidee par le redacteur — donne juste le contexte d'insertion

## SUGGESTIONS DE TITRE H1 (OBLIGATOIRE)

Tu DOIS proposer exactement 3 variantes de titre H1, chacune avec une strategie differente :
1. **Question** : formule le titre comme une question (cible le featured snippet Google)
2. **Promesse** : formule le titre comme une promesse de valeur claire pour le lecteur
3. **Specifique** : utilise des chiffres, donnees concretes ou l'annee ${currentYear} (OBLIGATOIRE : si une annee apparait, ce doit etre ${currentYear})

Chaque suggestion doit inclure :
- "title" : le titre H1 visible sur la page (50-65 caracteres ideal)
- "seo_title" : le Title SEO pour la balise <title> (50-60 caracteres, optimise CTR dans les SERP, peut differer du H1)
- "slug" : le slug URL correspondant (minuscules, sans accents, tirets, JAMAIS d'annee dans le slug — un slug doit etre intemporel)
- "seo_rationale" : 1 phrase expliquant pourquoi ce titre est optimise SEO

## FORMAT DE SORTIE
Tu DOIS retourner UNIQUEMENT un objet JSON valide, sans texte avant ou apres, sans bloc de code markdown.

{
  "title_suggestions": [
    {
      "title": "Titre H1 variante Question (cible featured snippet)",
      "seo_title": "Title SEO pour balise <title> (optimise CTR SERP)",
      "slug": "slug-question",
      "seo_rationale": "Explication SEO"
    },
    {
      "title": "Titre H1 variante Promesse (valeur lecteur)",
      "seo_title": "Title SEO pour balise <title> (optimise CTR SERP)",
      "slug": "slug-promesse",
      "seo_rationale": "Explication SEO"
    },
    {
      "title": "Titre H1 variante Specifique (chiffres/annee ${currentYear})",
      "seo_title": "Title SEO pour balise <title> (optimise CTR SERP, annee ${currentYear})",
      "slug": "slug-specifique-chiffres",
      "seo_rationale": "Explication SEO"
    }
  ],
  "meta_description": "Meta description engageante (140-160 caracteres)",
  "content_blocks": [
    {
      "id": "UUID — bloc intro OBLIGATOIRE en premier",
      "type": "paragraph",
      "heading": null,
      "content_html": "",
      "nugget_ids": [],
      "word_count": 120,
      "status": "pending",
      "writing_directive": "Intro courte (100-140 mots). Contient le mot-cle. Oriente vers l'intention de recherche. Accroche forte. 1-2 paragraphes <p> uniquement.",
      "format_hint": "prose",
      "generate_image": false,
      "internal_link_targets": []
    },
    {
      "id": "genere un UUID v4 unique",
      "type": "h2 | h3 | h4 | paragraph | list | faq",
      "heading": "Titre de la section (pour h2, h3, h4, faq) ou null",
      "content_html": "",
      "nugget_ids": ["ids des nuggets"],
      "word_count": 350,
      "status": "pending",
      "writing_directive": "Directive d'ecriture specifique pour ce bloc",
      "format_hint": "prose | bullets | table | mixed",
      "generate_image": true,
      "image_prompt_hint": "Editorial photo showing...",
      "key_ideas": ["Idee 1 exclusive a cette section", "Idee 2", "Idee 3"],
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
- Chaque suggestion doit avoir un "seo_title" (balise <title>, 50-60 car., optimise CTR) DISTINCT du "title" (H1 visible)
- "content_html" doit TOUJOURS etre "" (le contenu sera genere ensuite)
- "status" doit TOUJOURS etre "pending"
- Genere de vrais UUID v4 pour chaque "id" (format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
- Les slugs doivent etre en minuscules, sans accents, avec des tirets, et SANS annee (un slug est intemporel)
- La meta_description doit inciter au clic et contenir le mot-cle principal
- "writing_directive" est OBLIGATOIRE sur chaque bloc
- "format_hint" est OBLIGATOIRE sur chaque bloc
- "generate_image" doit etre present sur chaque bloc (true ou false). MINIMUM 5 blocs avec generate_image: true (sauf FAQ et tableaux purs)
- "image_prompt_hint" est requis uniquement si generate_image est true
- "internal_link_targets" est OBLIGATOIRE sur les blocs de type "h2" (tableau vide [] si aucun lien pertinent)
- "key_ideas" est OBLIGATOIRE sur chaque bloc de contenu (3-5 idees exclusives a cette section)`

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

    if (serpData.organic?.length > 0) {
      user += `\n\n### Top resultats organiques :`
      for (const result of serpData.organic.slice(0, 10)) {
        user += `\n${result.position}. "${result.title}" (${result.domain})`
        user += `\n   Snippet: ${result.snippet}`
      }
    }

    if (serpData.peopleAlsoAsk?.length > 0) {
      user += `\n\n### Questions "People Also Ask" (a integrer dans la FAQ) :`
      for (const paa of serpData.peopleAlsoAsk) {
        user += `\n- ${paa.question}`
      }
    }

    if (serpData.relatedSearches?.length > 0) {
      user += `\n\n### Recherches associees (mots-cles secondaires potentiels) :`
      for (const rs of serpData.relatedSearches) {
        user += `\n- ${rs.query}`
      }
    }
  }

  // Add nuggets if available
  if (nuggets.length > 0) {
    user += `\n\n## NUGGETS DISPONIBLES (contenus authentiques du persona)
Ces nuggets sont des pepites de connaissance REELLES du persona. Ils rendent le contenu unique et humain.

REGLES D'ASSIGNATION :
- Assigne les nuggets pertinents aux blocs via leur ID dans \`nugget_ids\`
- Chaque nugget ne doit etre assigne qu'a UN SEUL bloc (pas de doublon)
- Assigne en priorite les nuggets dont les tags correspondent au sujet du bloc
- Un bloc peut avoir 0 a 3 nuggets — ne force JAMAIS un nugget non pertinent
- Les nuggets de type "youtube" ou "vocal" sont souvent des temoignages riches — place-les dans les sections ou l'experience personnelle renforce la credibilite`

    for (const nugget of nuggets) {
      user += `\n\n### Nugget [${nugget.id}]`
      if (nugget.source_type) user += ` (source: ${nugget.source_type})`
      user += `\nTags: ${nugget.tags.join(', ') || 'aucun'}`
      user += `\nContenu: "${nugget.content}"`
    }
  }

  // Add existing site articles for internal linking
  if (existingSiloArticles && existingSiloArticles.length > 0) {
    user += `\n\n## ARTICLES EXISTANTS SUR LE SITE (maillage interne)
Voici la liste EXHAUSTIVE des articles disponibles pour le maillage interne.
REGLE ABSOLUE : tu ne peux linker QUE vers les slugs de cette liste. INTERDIT d'inventer des URLs ou des slugs qui ne sont pas ci-dessous.`

    for (const article of existingSiloArticles) {
      user += `\n- "${article.title || article.keyword}" → /${article.slug || ''}`
    }

    user += `\n\nSi aucun article de cette liste n'est pertinent pour une section, laisse internal_link_targets a [].`
  } else {
    user += `\n\n## MAILLAGE INTERNE
Aucun article existant sur le site. Laisse internal_link_targets a [] pour tous les blocs. N'invente AUCUN lien.`
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

      if (competitorContent.commonHeadings?.length > 0) {
        user += `\n\n### H2 recurrents chez les concurrents :`
        for (const heading of competitorContent.commonHeadings) {
          user += `\n- ${heading}`
        }
      }

      if (competitorContent.tfidfKeywords?.length > 0) {
        user += `\n\n### Termes TF-IDF les plus importants (top 20) :`
        for (const term of competitorContent.tfidfKeywords.slice(0, 20)) {
          user += `\n- "${term.term}" (score: ${term.tfidf.toFixed(4)}, ${term.df} pages)`
        }
      }
    }

    if (semanticAnalysis) {
      // Use selectedContentGaps if defined (user selection), otherwise fall back to all contentGaps
      const rawGaps = selectedContentGaps !== undefined
        ? selectedContentGaps
        : (semanticAnalysis.contentGaps || [])

      // Normalize gaps: objects → descriptive strings, strings → as-is
      const gapsToUse = (rawGaps || []).map(g => {
        if (typeof g === 'string') return g
        const obj = g as { label: string; type: string; description: string }
        return obj.description ? `[${obj.type}] ${obj.label} — ${obj.description}` : obj.label
      })

      if (gapsToUse.length > 0) {
        user += `\n\n### Lacunes de contenu a combler :
IMPORTANT : les lacunes entre crochets indiquent un FORMAT SPECIFIQUE a respecter. Par exemple [calculator] signifie que le bloc doit presenter un simulateur/calculateur sous forme de tableau interactif, [comparison] un tableau comparatif detaille, [checklist] une liste actionnable, etc. Adapte le format_hint et la writing_directive du bloc en consequence.`
        for (const gap of gapsToUse) {
          user += `\n- ${gap}`
        }
      }

      if (semanticAnalysis.semanticField?.length > 0) {
        user += `\n\n### Champ semantique a integrer :`
        user += `\n${semanticAnalysis.semanticField.join(', ')}`
      }

      if (semanticAnalysis.recommendedH2Structure?.length > 0) {
        user += `\n\n### Structure H2 recommandee :`
        for (const h2 of semanticAnalysis.recommendedH2Structure) {
          user += `\n- ${h2}`
        }
      }

      if (semanticAnalysis.keyDifferentiators?.length > 0) {
        user += `\n\n### Angles differenciateurs :`
        for (const diff of semanticAnalysis.keyDifferentiators) {
          user += `\n- ${diff}`
        }
      }

      if (semanticAnalysis.mustAnswerQuestions?.length > 0) {
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

  user += `\n\n## ANNEE DE REFERENCE — REGLE ABSOLUE
Nous sommes en ${currentYear}. TOUTE reference temporelle, date ou annee dans les titres, seo_titles, meta_description et content_blocks DOIT etre ${currentYear}.
INTERDIT : 2024, 2025 ou toute annee autre que ${currentYear}.
EXCEPTION SLUG : les slugs ne doivent JAMAIS contenir d'annee (un slug est intemporel, il ne change pas d'une annee a l'autre).`

  user += `\n\n## INSTRUCTIONS FINALES
1. PYRAMIDE INVERSEE : le premier H2 repond DIRECTEMENT a l'intention de recherche
2. **Hn SEMANTIQUES (CRITIQUE)** : CHAQUE H2 DOIT contenir le mot-cle principal, un synonyme ou un terme TF-IDF/semantique du domaine. Un H2 sans ancrage semantique (ex: "Les avantages", "Notre avis", "Conseils") est une ERREUR GRAVE. Relis chaque H2 et verifie qu'il envoie un signal semantique a Google. Utilise les formules : [Verbe] + [mot-cle/variante] + [qualificateur], ou [Question mot-cle] + [precision]
3. WRITING DIRECTIVES : chaque bloc a une directive d'ecriture specifique et un format_hint
4. IMAGES : minimum 5 images reparties equilibrement dans l'article (toutes les H2 sauf FAQ/tableaux purs)
5. Analyse les SERP pour surpasser les contenus existants en profondeur et en valeur
6. QUESTIONS PAA EN H2/H3 : si une question PAA correspond a un angle de l'article, utilise-la telle quelle ou reformulee comme H2 ou H3. Integre les restantes dans la FAQ
7. Assigne les nuggets pertinents aux blocs appropries
8. Propose 3 variantes de titre H1 (question, promesse, specifique) + meta description optimisee
9. WORD COUNT TOTAL — VERIFIE AVANT DE REPONDRE : additionne les word_count de TOUS les blocs. Le total DOIT etre dans la fourchette de la strategie (ex: traffic = 2000-3000 mots). Si le total est inferieur au minimum, AJOUTE des blocs ou AUGMENTE les word_count existants. Un article de 1200 mots sur une intention "traffic" (minimum 2000) est une ERREUR GRAVE.
10. Au moins 2 H2 doivent contenir le mot-cle principal ou une variante tres proche
11. DECOUPE H3 : si un H2 necessite plus de 400 mots, decoupe-le en H3 specifiques (2-4 H3 par H2). Les H3 ciblent les variantes longue traine et recherches associees
12. BLOC INTRO OBLIGATOIRE : le PREMIER element de content_blocks doit etre un bloc type "paragraph", heading null, word_count 120, contenant le mot-cle principal. Ce bloc precede le premier H2.
13. WORD COUNT MINIMUM : chaque bloc H2 DOIT avoir word_count >= 250. Chaque H3 >= 150. JAMAIS de word_count < 120 sauf intro. Un word_count de 30, 50 ou 80 est une ERREUR — le redacteur ne peut rien ecrire de substantiel en si peu de mots.
14. KEY IDEAS MECE : chaque bloc a un "key_ideas" (3-5 idees) qui definit son perimetre exclusif. AUCUN chevauchement entre sections.
15. LONGUEUR DES TITRES : chaque heading H2/H3/H4 DOIT faire MAX 80 caracteres. Compte les caracteres avant de valider. Si un titre depasse 80 chars, reformule-le plus court.
16. FAQ : le heading du bloc FAQ doit etre simplement "FAQ" (pas de variante longue). Le balisage Schema.org FAQPage est OBLIGATOIRE dans le HTML genere.
17. **TERMES TF-IDF EN Hn** : si des termes TF-IDF sont fournis, au moins 3-5 de ces termes doivent apparaitre dans les H2/H3 de l'article (integres naturellement, pas forces). Ils enrichissent le signal semantique pour Google.

Retourne UNIQUEMENT le JSON, rien d'autre.`

  return { system, user }
}

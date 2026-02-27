// ============================================================
// SEO Guidelines — Shared constants for all AI prompts
// Single source of truth for SEO rules used by:
// - block-writer.ts (content writing)
// - plan-architect.ts (article planning)
// - critique.ts (content evaluation)
// ============================================================

/**
 * E-E-A-T (Experience, Expertise, Authority, Trust) rules.
 * Used by: block-writer, plan-architect, critique
 */
export const SEO_EEAT_RULES = `- Montre l'EXPERIENCE personnelle du persona (anecdotes, cas concrets, vecu terrain)
- Demontre l'EXPERTISE avec des donnees precises, des analyses approfondies
- Renforce l'AUTORITE en citant des sources, des etudes, des references
- Assure la FIABILITE avec des informations exactes, a jour et equilibrees
- Donne des conseils actionables et concrets, pas d'affirmations vagues

Penalites E-E-A-T :
- Contenu generique sans valeur ajoutee
- Absence d'exemples ou de cas concrets
- Affirmations non etayees
- Style impersonnel / "IA" evident`

/**
 * FAQ format and rules (HTML accordion + Schema.org).
 * Used by: block-writer, plan-architect
 */
export const SEO_FAQ_RULES = `Format HTML : accordion natif <details>/<summary> avec balisage Schema.org FAQ.
Structure pour chaque Q/R :
<div class="faq-section">
  <details class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
    <summary itemprop="name">Question ici ?</summary>
    <div class="faq-answer" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
      <div itemprop="text">
        <p>Reponse directe en 2-4 phrases. Solution concrete.</p>
      </div>
    </div>
  </details>
</div>

Regles FAQ :
- Reponses COURTES : 2-4 phrases maximum, directes et actionables
- Chaque reponse donne une VRAIE SOLUTION rapide a la question posee
- Optimise pour le featured snippet Google (reponse immediate, pas de bavardage)
- 3 a 6 questions basees sur les "People Also Ask"`

/**
 * Forbidden AI-sounding patterns.
 * Used by: block-writer, critique
 */
export const SEO_ANTI_AI_PATTERNS = `Formulations INTERDITES (style ChatGPT/IA generique) :
- "Dans cet article nous allons..."
- "Il est important de noter que..."
- "Il convient de..."
- "Force est de constater..."
- "Dans un premier temps..."
- "Voyons maintenant..."
- "Dans cette section..."
- "Depuis la nuit des temps..."
- "Comme nous l'avons vu..."
- "En conclusion..."
- Toute formulation generique ou bateau reconnaissable comme generee par IA

Ponctuation et typographie INTERDITES :
- PAS de guillemets francais (\u00ab \u00bb) ni typographiques (\u201c \u201d)
- PAS de tiret cadratin (\u2014) ni demi-cadratin (\u2013) — utilise le tiret simple (-) ou reformule
- PAS de points de suspension excessifs (...)
- PAS de guillemets autour de mots ou expressions dans le texte courant (ex: INTERDIT d'ecrire les "experts", un "vrai" probleme, la "meilleure" solution). Ecris directement sans guillemets. Les guillemets sont reserves UNIQUEMENT aux citations directes d'une personne.
- Utilise uniquement le tiret simple (-)`

/**
 * Keyword density and placement rules.
 * Used by: block-writer, critique
 */
export const SEO_KEYWORD_RULES = `- Densite du mot-cle principal : 0.5-2.5% (naturelle, jamais forcee)
- JAMAIS de keyword stuffing — chaque occurrence doit sonner naturelle
- Si une phrase semble forcee pour placer un mot-cle, REFORMULE-LA jusqu'a ce que l'insertion soit invisible
- AU MOINS un H2 doit contenir le mot-cle principal ou une variante tres proche
- Le mot-cle doit apparaitre dans les 100 premiers mots de l'article
- Utilise des variantes, synonymes et mots-cles de longue traine pour enrichir le signal semantique
- Champ semantique riche et varie dans tous les blocs — les termes connexes doivent etre integres de maniere invisible
- Structure le contenu pour faciliter la lecture (paragraphes courts, listes quand adapte)`

/**
 * Semantic field enrichment rules.
 * Used by: block-writer, critique
 */
export const SEO_SEMANTIC_FIELD_RULES = `- Champ semantique riche : utilise des mots-cles lies (LSI) et des termes co-occurrents
- Integre le vocabulaire TF-IDF du domaine naturellement dans le texte
- Varie le vocabulaire : synonymes, expressions proches, termes du champ lexical
- Ne te limite pas au mot-cle exact — enrichis avec l'ecosysteme semantique du sujet`

/**
 * Heading hierarchy rules (H2/H3 structure).
 * Used by: plan-architect, critique
 */
export const SEO_HEADING_STRUCTURE_RULES = `Regles H2 :
- Chaque H2 doit etre une QUESTION ou une PROMESSE claire (pas de titres vagues)
- Chaque H2 doit etre comprehensible DE FACON ISOLEE (pense featured snippet Google)
- Integre des mots-cles secondaires naturellement dans les H2
- AU MOINS un H2 doit contenir le mot-cle principal ou une variante tres proche
- 3 a 6 sections H2 par article
- MAX 80 caracteres par titre H2/H3 — si plus long, reformule
- Utilise des VERBES D'ACTION dans les titres (Comparer, Choisir, Eviter, Optimiser...)
- Exemples BONS : "Quel budget prevoir pour une renovation de salle de bain ?"
- Exemples MAUVAIS : "Le budget", "Parlons argent", "Introduction"

Regles H3 :
- Chaque H3 = sous-aspect CONCRET du H2 parent
- 1 a 3 H3 par H2 maximum
- Les H3 doivent integrer des variantes du mot-cle
- Ne saute JAMAIS un niveau (pas de H3 sans H2 parent)`

/**
 * Internal linking strategy rules.
 * Used by: block-writer, plan-architect
 */
export const SEO_INTERNAL_LINKING_RULES = `- L'ancre ne doit JAMAIS etre le titre exact, ni l'URL, ni le slug de la page cible
- L'ancre = expression naturelle de 2-6 mots integree dans la phrase
- JAMAIS de "cliquez ici" ou "en savoir plus" comme ancre
- Chaque lien doit apporter de la valeur au lecteur
- Max 2-3 liens internes par section H2 (pas de sur-optimisation)
- Un meme target_slug ne peut apparaitre qu'1 fois dans tout l'article
- Place les liens la ou c'est NATUREL par rapport au sujet de la section`

/**
 * Writing style and readability rules.
 * Used by: block-writer, critique
 */
export const SEO_WRITING_STYLE_RULES = `- Ecris dans un style naturel, fluide et engageant
- Phrases courtes et percutantes. UNE IDEE PAR PHRASE. Pas de phrases a rallonge.
- Alterne phrases courtes (impact) et moyennes (explication). Evite les phrases longues (>25 mots).
- Integre des exemples concrets, des chiffres, des cas pratiques quand c'est pertinent
- Utilise des transitions naturelles entre les paragraphes
- Paragraphes courts (3-4 lignes max) pour une lecture facile sur ecran
- Pas de formulations generiques ou bateaux
- Pas de repetitions excessives, pas de style monotone
- Zero fluff : chaque phrase doit apporter de l'information ou de la valeur. Supprime tout remplissage.

Style humain et accessible :
- Ecris comme un humain expert qui parle a un autre humain
- Vocabulaire simple et direct, accessible a tous
- Tournures actives plutot que passives
- Mots concrets plutot qu'abstractions
- Adresses directes au lecteur (vous, votre)
- Adopte un ton qui parle directement a la cible du persona`

/**
 * Intent-specific strategies for plan, writing, and critique.
 * Each search intent has radically different structure, style, and SEO techniques.
 * Used by: plan-architect, block-writer, critique
 */
export const INTENT_STRATEGIES: Record<string, { plan: string; writing: string; critique: string }> = {
  traffic: {
    plan: `Strategie "traffic" — Ranker en position 1-3 SERP :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : annonce la reponse directe en 100-140 mots, contient le mot-cle principal
- Pyramide inversee STRICTE. Premier H2 = reponse directe optimisee featured snippet
- 2000-3000 mots. Couverture exhaustive du sujet
- H2 clairs et autonomes (chaque H2 = mini-reponse pour featured snippet)
- FAQ obligatoire basee sur PAA
- format_hint prioritaire : "mixed" et "prose"`,
    writing: `Strategie d'ecriture "traffic" — Objectif : featured snippet + position 1-3 :
- Densite semantique maximale, variantes LSI, expressions en gras (<strong>)
- Paragraphes courts (3-4 lignes). Chaque H2 = reponse autonome
- Pas de suspense — reponse IMMEDIATE des la premiere phrase du bloc
- Phrases concises, chiffres quand possible
- Mets en gras les termes-cles et les donnees importantes`,
    critique: `Criteres specifiques "traffic" :
- Couverture sujet exhaustive vs concurrents (toutes les sous-questions traitees ?)
- Densite semantique suffisante (variantes LSI presentes ?)
- Chaque H2 est-il "featured-snippet-ready" (reponse autonome en 2-3 phrases) ?
- Objectif 2000-3000 mots atteint ?
- FAQ basee sur PAA presente ?`,
  },

  review: {
    plan: `Strategie "review" — Ranker + GEO (Generative Engine Optimization) :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : annonce le verdict en 100-140 mots, contient le mot-cle principal
- Premier H2 = verdict rapide / "Mon avis en bref" avec note
- Structure : verdict → criteres detailles avec scores → avantages/inconvenients → a qui ca s'adresse → verdict final
- Mots-cles GEO obligatoires dans H2 : "meilleur", "avis", "test", "top N"
- format_hint : "bullets" pour avantages/inconvenients, "mixed" pour criteres
- 1800-2500 mots
- PAS de H2 "Qu'est-ce que..." en ouverture — commence par le verdict`,
    writing: `Strategie d'ecriture "review" — Objectif : avis expert + GEO :
- Ton expert testeur, avis TRANCHE (pas neutre — prends position clairement)
- Formulations GEO : "meilleur [X] en 2026", "notre avis sur [X]", "top [N] des..."
- Listes puces avec check/croix dans le texte pour pros/cons (ex: "✓ Excellent rapport qualite-prix" / "✗ Interface peu intuitive")
- Sections "A qui s'adresse ce produit" et "Pour qui ce n'est PAS fait"
- Note / score sur 10 ou sur 5 etoiles (ex: "⭐ 4.2/5" ou "Note : 8.5/10")
- Chaque critere evalue doit avoir un score ou une appreciation claire`,
    critique: `Criteres specifiques "review" :
- Presence des mots-cles GEO dans les H2 ("meilleur", "avis", "test") ?
- Verdict clair et tranche des le premier H2 (pas de reponse tiede) ?
- Avantages et inconvenients clairement listes ?
- Note ou score present ?
- Avis personnel et expertise perceptibles (pas un resume neutre) ?`,
  },

  comparison: {
    plan: `Strategie "comparison" — Ranker sur "[A] vs [B]" :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : pose le contexte du comparatif en 100-140 mots, contient le mot-cle principal
- Premier H2 = tableau comparatif DIRECT (pas d'intro "qu'est-ce que")
- Structure OBLIGATOIRE : intro courte (1 paragraphe contexte) → tableau comparatif → analyse par critere → verdict "Lequel choisir selon votre profil"
- Le tableau utilise <div class="table-container"><table>...</table></div> avec colonnes produits
- format_hint : "table" pour le bloc comparatif principal, "prose" pour les analyses
- 1500-2500 mots
- Le dernier H2 avant FAQ = "Lequel choisir ?" avec verdict personnalise par profil`,
    writing: `Strategie d'ecriture "comparison" — Objectif : comparatif objectif + verdict :
- Tableau HTML dans <div class="table-container"><table> avec <thead> Critere | Produit A | Produit B
- Design epure : pas de bordures lourdes, zebra-striping et hover geres par CSS
- Attribut data-removable="true" sur les <th>/<td> des colonnes produit
- Apres le tableau : analyse prose de chaque critere important
- Ton objectif et factuel, chiffres precis
- Verdict personnalise : "Si vous cherchez X → Produit A / Si votre priorite est Y → Produit B"
- Ne favorise pas un produit arbitrairement — argumente chaque recommandation`,
    critique: `Criteres specifiques "comparison" :
- Tableau comparatif present dans un <div class="table-container"> ?
- Equilibre entre les produits compares (pas de biais visible) ?
- Verdict "lequel choisir selon votre profil" present ?
- Format standardise (tableau + analyses par critere) respecte ?
- Criteres de comparaison pertinents et factuels ?`,
  },

  discover: {
    plan: `Strategie "discover" — Google Discover / actualite chaude :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : accroche journalistique en 100-140 mots, contient le mot-cle principal
- Structure "news hook" avec suspense
- Premier H2 = accroche forte + contexte actualite (SANS reveler l'info principale)
- H2 suivants = montee en tension, contexte, enjeux
- Info cruciale = dans l'avant-dernier H2 seulement (apres 60-70% de l'article)
- Dernier H2 = consequences / analyse / "et maintenant ?"
- PAS de FAQ (format news — ne mets PAS de bloc type "faq")
- 1200-1800 mots (plus court, plus punchy)
- generate_image: true sur TOUS les H2 (images fortes accrocheuses)`,
    writing: `Strategie d'ecriture "discover" — Objectif : retention + Google Discover :
- Style journalistique news, phrases d'accroche percutantes
- Creer curiosite sans clickbait malhonnete
- Structure suspense : contexte → tension → revelation → consequences
- Paragraphes TRES courts (2-3 lignes max)
- Questions rhetoriques pour maintenir l'attention
- Mots emotionnellement charges dans les formulations
- NE PAS reveler l'info cle trop tot — la placer apres 60% du contenu`,
    critique: `Criteres specifiques "discover" :
- L'info cle n'est PAS dans le premier H2 (suspense respecte) ?
- Accroche forte et engageante des le debut ?
- Rythme news (paragraphes courts, phrases percutantes) ?
- Retention : le lecteur a-t-il envie de continuer a lire ?
- Objectif 1200-1800 mots respecte (pas trop long) ?
- Pas de FAQ (format news) ?`,
  },

  lead_gen: {
    plan: `Strategie "lead_gen" — Money page / conversion :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : identifie le probleme du lecteur en 100-140 mots, contient le mot-cle principal
- Premier H2 = identification du probleme du lecteur (pain point)
- H2 suivants = solution + benefices concrets + social proof
- Bloc "callout" type callout-important avec CTA principal apres les benefices
- Formulaire HTML <form class="lead-form"> avec champs pertinents dans un bloc dedie
- FAQ orientee objections (lever les freins a la conversion)
- CTA repartis (au moins 2-3 dans l'article, pas juste en fin)
- 1500-2500 mots`,
    writing: `Strategie d'ecriture "lead_gen" — Objectif : conversion :
- Copywriting conversion. Adresse le lecteur directement ("vous")
- Framework PAS : Probleme → Agitation → Solution
- Benefices > caracteristiques (pas "notre outil fait X" mais "vous gagnez Y")
- Urgence subtile, chiffres de resultats concrets
- Formulaire HTML : <form class="lead-form"> avec <input>, <select>, <button type="submit">
- CTA en <div class="callout callout-important"> avec bouton d'action
- Temoignages en <blockquote class="testimonial">
- Chaque section doit ramener vers la conversion sans etre agressif`,
    critique: `Criteres specifiques "lead_gen" :
- Presence de CTA multiples (au moins 2-3 repartis dans l'article) ?
- Formulaire present avec class="lead-form" ?
- Social proof (temoignages, chiffres, resultats) ?
- Framework PAS respecte (Probleme → Agitation → Solution) ?
- Focus sur les benefices plutot que les caracteristiques ?
- FAQ orientee objections (leve les freins) ?`,
  },

  informational: {
    plan: `Strategie "informational" — Guide pedagogique / reference :
- Bloc intro (OBLIGATOIRE, type "paragraph", heading null) : pose le sujet de maniere accessible en 100-140 mots, contient le mot-cle principal
- Premier H2 = definition / explication principale claire
- H2 suivants = approfondissement progressif (simple → complexe)
- Exemples concrets dans chaque section
- H2 "Erreurs courantes" ou "Pieges a eviter" recommande
- FAQ pedagogique
- 2000-3500 mots (le plus long)
- format_hint : "mixed" et "prose" principalement`,
    writing: `Strategie d'ecriture "informational" — Objectif : guide de reference :
- Ton pedagogique, progressif, accessible
- Du simple vers le complexe (chaque section monte d'un cran)
- Exemples concrets dans CHAQUE section, analogies pour les concepts difficiles
- Encadres "A retenir" en <div class="callout callout-tip"> pour les points cles
- Vocabulaire technique defini a la premiere occurrence (entre parentheses ou en incise)
- Transitions douces entre sections pour guider le lecteur`,
    critique: `Criteres specifiques "informational" :
- Progression pedagogique respectee (simple → complexe) ?
- Exemples concrets dans chaque section ?
- Definitions presentes pour le vocabulaire technique ?
- Accessibilite du vocabulaire (pas trop technique sans explication) ?
- Objectif 2000-3500 mots atteint ?
- Section "erreurs courantes" ou "pieges a eviter" presente ?`,
  },
}

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
- UTILISE LA BIO DU PERSONA : si le persona a une backstory (maison, situation, parcours), ancre le contenu dedans. Exemple : un persona qui vit dans une maison des annees 80 doit partager des retours d'experience concrets lies a cette realite. La bio n'est pas decorative — c'est la preuve vivante de l'expertise.
- Demontre l'EXPERTISE avec des donnees precises, des analyses approfondies
- Renforce l'AUTORITE en citant des sources, des etudes, des references
- Assure la FIABILITE avec des informations exactes, a jour et equilibrees
- Donne des conseils actionables et concrets, pas d'affirmations vagues

Penalites E-E-A-T :
- Contenu generique sans valeur ajoutee
- Absence d'exemples ou de cas concrets
- Affirmations non etayees
- Style impersonnel / "IA" evident
- Persona present dans la bio mais JAMAIS cite ou ancre dans le contenu`

/**
 * FAQ format and rules (HTML accordion + Schema.org).
 * Used by: block-writer, plan-architect
 */
export const SEO_FAQ_RULES = `Format HTML : le bloc FAQ DOIT contenir le H2 + l'accordion natif <details>/<summary> avec balisage Schema.org FAQ.
Structure COMPLETE a generer :
<h2>Questions frequentes</h2>
<div class="faq-section" itemscope itemtype="https://schema.org/FAQPage">
  <details class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
    <summary itemprop="name">Question ici ?</summary>
    <div class="faq-answer" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
      <div itemprop="text">
        <p>Reponse directe en 2-4 phrases. Solution concrete.</p>
      </div>
    </div>
  </details>
  <!-- Repeter <details> pour chaque question -->
</div>

Regles FAQ :
- Le <h2> DOIT etre inclus UNE SEULE FOIS dans le HTML genere. NE DUPLIQUE JAMAIS le titre — si tu generes <h2>FAQ</h2>, ne le repete pas
- Le heading du bloc FAQ est "FAQ" — pas de variante longue comme "FAQ : Vos questions recurrentes sur..."
- Reponses COURTES : 2-4 phrases maximum, directes et actionables
- Chaque reponse donne une VRAIE SOLUTION rapide a la question posee
- Optimise pour le featured snippet Google (reponse immediate, pas de bavardage)
- 3 a 6 questions basees sur les "People Also Ask"`

/**
 * Forbidden AI-sounding patterns.
 * Used by: block-writer, critique
 */
export const SEO_ANTI_AI_PATTERNS = `Formulations INTERDITES (style ChatGPT/IA generique) :
- "dans cet article" (sous TOUTES ses formes : "dans cet article nous allons", "dans cet article vous decouvrirez", "cet article vous explique", "cet article explore", etc.)
- "Il est important de noter que..."
- "Il convient de..."
- "Force est de constater..."
- "Dans un premier temps..."
- "Voyons maintenant..."
- "Dans cette section..."
- "Depuis la nuit des temps..."
- "Comme nous l'avons vu..."
- "En conclusion..." / "En resume..." / "En definitive..." / "Ainsi..." (en debut de phrase conclusive)
- "Au fil de cet article..." / "Tout au long de cet article..."
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
 * Heading hierarchy rules (H2/H3/H4 structure).
 * Used by: plan-architect, critique
 */
export const SEO_HEADING_STRUCTURE_RULES = `## OPTIMISATION SEMANTIQUE DES Hn — REGLES CRITIQUES

### Principe fondamental
Les titres H2/H3/H4 sont les signaux semantiques les PLUS PUISSANTS de l'article pour Google. Un bon heading = mot-cle ou variante sémantique + qualificateur concret + intention utilisateur. Google utilise les Hn pour comprendre la STRUCTURE THEMATIQUE de la page. Chaque Hn doit enrichir le signal semantique global.

### Regles de formulation semantique des H2
- **Mot-cle + qualificateur** : chaque H2 doit contenir SOIT le mot-cle principal, SOIT une variante semantique proche (synonyme, terme LSI, cooccurrence forte). JAMAIS de H2 generique sans ancrage semantique
- **AU MOINS 2 H2** doivent contenir le mot-cle principal ou une variante TRES proche (pas juste un mot du champ semantique)
- **Chaque H2 restant** doit contenir au minimum un terme du champ semantique ou un terme TF-IDF pertinent
- Chaque H2 doit etre une QUESTION ou une PROMESSE claire (pas de titres vagues)
- Chaque H2 doit etre comprehensible DE FACON ISOLEE (pense featured snippet Google)
- Utilise des VERBES D'ACTION qui ancrent l'intention : Comparer, Choisir, Eviter, Calculer, Installer, Optimiser, Reparer...
- 3 a 6 sections H2 par article
- MAX 80 caracteres par titre H2/H3/H4 — si plus long, reformule

### Technique de construction d'un H2 optimise
1. Pars de l'INTENTION utilisateur pour cette section (que cherche-t-il ?)
2. Integre le mot-cle principal OU un terme TF-IDF/semantique du domaine
3. Ajoute un qualificateur concret : chiffre, annee, comparatif, question, benefice
4. Verifie que le H2 SEUL pourrait etre un titre de featured snippet

**Formules qui fonctionnent :**
- "[Verbe d'action] + [mot-cle/variante] + [qualificateur]" → "Calculer le cout d'un poele de masse en 2026"
- "[Question mot-cle] + [precision]" → "Quel rendement attendre d'un poele de masse a accumulation ?"
- "[Comparatif/Superlatif] + [mot-cle] + [critere]" → "Les 5 meilleurs materiaux pour un poele de masse"
- "[Mot-cle] + [vs/ou/face a] + [alternative]" → "Poele de masse ou poele a granules : quelle difference ?"
- "[Comment/Pourquoi] + [mot-cle] + [objectif]" → "Comment entretenir un poele de masse pour durer 30 ans"

**INTERDIT en H2 (zero signal semantique) :**
- Titres generiques : "Le budget", "Les avantages", "Notre avis", "Conseils pratiques", "Ce qu'il faut savoir"
- Titres narratifs : "Parlons argent", "Introduction", "Notre analyse", "Focus sur..."
- Titres sans mot-cle NI terme semantique : "A retenir", "En pratique", "Les erreurs", "Notre verdict"

**Exemples concrets :**
- MAUVAIS : "Les avantages" → BON : "5 avantages concrets du poele de masse face au chauffage electrique"
- MAUVAIS : "Notre avis" → BON : "Poele de masse : notre verdict apres 3 hivers d'utilisation"
- MAUVAIS : "Le budget" → BON : "Quel budget prevoir pour installer un poele de masse en 2026 ?"
- MAUVAIS : "Conseils pratiques" → BON : "Comment choisir l'emplacement ideal pour un poele de masse ?"
- MAUVAIS : "Comparatif" → BON : "Poele de masse vs insert a bois : performances et prix compares"

### Enrichissement semantique via donnees SERP
- Les **termes TF-IDF** fournis indiquent les mots que Google ATTEND dans un article sur ce sujet. Integre-les dans les H2/H3 quand c'est naturel
- Les **questions PAA** (People Also Ask) sont des formulations EXACTES que les utilisateurs tapent. Reprends-les telles quelles en H2 ou H3 quand elles correspondent a une section
- Les **recherches associees** contiennent des variantes longue traine du mot-cle. Utilise-les dans les H3
- Les **H2 des concurrents** montrent les angles deja couverts — couvre-les TOUS et ajoute des angles uniques

### Regles H3
- Chaque H3 = sous-aspect CONCRET du H2 parent
- Chaque H3 doit contenir une **variante semantique** du mot-cle OU un terme TF-IDF specifique au sous-sujet
- 1 a 3 H3 par H2 maximum
- Ne saute JAMAIS un niveau (pas de H3 sans H2 parent)
- Utilise des H3 pour decouper les sections H2 longues (>400 mots) en sous-parties lisibles
- Les H3 ciblent les requetes longue traine : reprends les recherches associees et PAA specifiques

### Regles H4
- Chaque H4 = detail precis sous un H3 parent
- 1 a 3 H4 par H3 maximum
- Utilise des H4 quand un H3 couvre plusieurs points distincts qui meritent un titre
- Ne saute JAMAIS un niveau (pas de H4 sans H3 parent)
- Optionnel : n'utilise des H4 que si le contenu est suffisamment dense pour le justifier`

/**
 * Internal linking strategy rules.
 * Used by: block-writer, plan-architect
 */
export const SEO_INTERNAL_LINKING_RULES = `- L'ancre ne doit JAMAIS etre le titre exact, ni l'URL, ni le slug de la page cible
- L'ancre = expression naturelle de 2-6 mots integree dans la phrase
- JAMAIS de "cliquez ici" ou "en savoir plus" comme ancre
- Max 2-3 liens internes par section H2 (pas de sur-optimisation)
- Un meme target_slug ne peut apparaitre qu'1 fois dans tout l'article
- REGLE CRITIQUE — ZERO HORS-SUJET POUR LE MAILLAGE : un lien interne = UNE balise <a> glissee dans une phrase qui parle DEJA du sujet de l'article en cours. Tu ne dois JAMAIS ecrire de phrase, de paragraphe ou de transition dont le but est d'introduire le sujet de l'article cible. Si le sujet de l'article cible n'a aucun rapport naturel avec la phrase en cours, NE PLACE PAS le lien. Mieux vaut 0 lien interne qu'un paragraphe hors-sujet.
- Le lien doit etre INVISIBLE pour le lecteur : il doit tomber sur un mot ou une expression qui fait deja partie du discours, pas sur un detour thematique force`

/**
 * Writing style and readability rules.
 * Used by: block-writer, critique
 */
export const SEO_WRITING_STYLE_RULES = `- Ecris dans un style naturel, fluide et engageant
- Phrases courtes et percutantes. UNE IDEE PAR PHRASE. Pas de phrases a rallonge.
- Alterne phrases courtes (impact) et moyennes (explication). Evite les phrases longues (>25 mots).
- Integre des exemples concrets, des chiffres, des cas pratiques quand c'est pertinent
- Utilise des transitions naturelles entre les paragraphes
- Paragraphes courts (2-3 lignes max) pour une lecture facile sur ecran — un paragraphe de 5+ lignes est TROP LONG, decoupe-le
- Pas de formulations generiques ou bateaux
- Pas de repetitions excessives, pas de style monotone
- Zero fluff : chaque phrase doit apporter de l'information ou de la valeur. Supprime tout remplissage.
- RYTHME VISUEL : alterne prose courte → liste a puces → prose → tableau → prose. Le lecteur ne doit JAMAIS voir un bloc de texte compact de plus de 6 lignes sans respiration visuelle.

Style humain et accessible :
- Ecris comme un humain expert qui parle a un autre humain
- Vocabulaire simple et direct, accessible a tous
- Tournures actives plutot que passives
- Mots concrets plutot qu'abstractions
- Adresses directes au lecteur (vous, votre)
- Adopte un ton qui parle directement a la cible du persona`

/**
 * Table style presets per site domain.
 * Each site has 2 styles that alternate within an article for visual variety.
 * Style 1 = even tables (0, 2, 4...), Style 2 = odd tables (1, 3, 5...)
 */
export interface TableStylePreset {
  name: string
  thBg: string
  thColor: string
  thBorder?: string
  trAltBg: string
  tdBorder: string
  accentColor?: string
  containerBorder?: string
}

export const SITE_TABLE_STYLES: Record<string, [TableStylePreset, TableStylePreset]> = {
  'smakk.fr': [
    {
      name: 'Impact',
      thBg: '#00052F',
      thColor: '#FFFFFF',
      trAltBg: '#F0F6FC',
      tdBorder: '#E2E8F0',
    },
    {
      name: 'Epure',
      thBg: '#F0F6FC',
      thColor: '#00052F',
      thBorder: '2px solid #0A6CFF',
      trAltBg: '#FAFBFF',
      tdBorder: '#0A6CFF',
      accentColor: '#FB8E28',
      containerBorder: '1px solid #0A6CFF',
    },
  ],
  'mon-habitat-durable.fr': [
    {
      name: 'Autorite',
      thBg: '#2D5A27',
      thColor: '#FFFFFF',
      trAltBg: '#E8F5E9',
      tdBorder: '#C8E6C9',
    },
    {
      name: 'Pratique',
      thBg: '#E8F5E9',
      thColor: '#2D5A27',
      thBorder: '2px solid #26BD26',
      trAltBg: '#F1F8E9',
      tdBorder: '#26BD26',
      accentColor: '#FCD34D',
      containerBorder: '1px solid #26BD26',
    },
  ],
}

/** Default table styles for sites not in the registry */
export const DEFAULT_TABLE_STYLES: [TableStylePreset, TableStylePreset] = [
  {
    name: 'Classique',
    thBg: '#1e293b',
    thColor: '#FFFFFF',
    trAltBg: '#f8fafc',
    tdBorder: '#e2e8f0',
  },
  {
    name: 'Leger',
    thBg: '#f1f5f9',
    thColor: '#1e293b',
    thBorder: '2px solid #3b82f6',
    trAltBg: '#fafbff',
    tdBorder: '#3b82f6',
    accentColor: '#f59e0b',
    containerBorder: '1px solid #3b82f6',
  },
]

/**
 * Get the table style for a given site domain and table index.
 * Alternates between Style 1 (even index) and Style 2 (odd index).
 */
export function getTableStyleForSite(siteDomain: string | undefined, tableIndex: number): TableStylePreset {
  const domain = siteDomain?.toLowerCase().replace(/^www\./, '') || ''
  const styles = SITE_TABLE_STYLES[domain] || DEFAULT_TABLE_STYLES
  return styles[tableIndex % 2]
}

/**
 * Build the full table HTML template for the AI prompt based on the style preset.
 */
export function buildTablePromptTemplate(style: TableStylePreset): string {
  const containerBorder = style.containerBorder ? `;border:${style.containerBorder}` : ''
  const thBorder = style.thBorder ? `;border-bottom:${style.thBorder}` : ''

  return `<div class="table-container" style="width:100%;overflow-x:auto;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin:20px 0${containerBorder}">
  <table style="width:100%;border-collapse:collapse;min-width:500px">
    <thead>
      <tr>
        <th style="background:${style.thBg};color:${style.thColor};padding:14px 16px;font-weight:600;text-align:left;font-size:0.9rem${thBorder}">En-tete 1</th>
        <th style="background:${style.thBg};color:${style.thColor};padding:14px 16px;font-weight:600;text-align:left;font-size:0.9rem${thBorder}">En-tete 2</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid ${style.tdBorder}">Donnee</td>
        <td style="padding:12px 16px;border-bottom:1px solid ${style.tdBorder}">Donnee</td>
      </tr>
      <tr style="background:${style.trAltBg}">
        <td style="padding:12px 16px;border-bottom:1px solid ${style.tdBorder}">Donnee</td>
        <td style="padding:12px 16px;border-bottom:1px solid ${style.tdBorder}">Donnee</td>
      </tr>
    </tbody>
  </table>
</div>`
}

/**
 * Build the table style rules description for the AI prompt.
 */
export function buildTableStyleRules(style: TableStylePreset): string {
  const thBorderRule = style.thBorder ? `, border-bottom ${style.thBorder}` : ''
  const containerBorderRule = style.containerBorder ? `, border ${style.containerBorder}` : ''
  const accentRule = style.accentColor ? `\n- Accent (donnees importantes, badges, chiffres cles) : color ${style.accentColor} ou background ${style.accentColor}` : ''

  return `- <th> : fond ${style.thBg}, texte ${style.thColor}, padding 14px 16px, font-weight 600${thBorderRule}
- <td> : padding 12px 16px, border-bottom 1px solid ${style.tdBorder}
- Lignes paires <tr> : style="background:${style.trAltBg}" (zebra-striping)
- Derniere ligne : pas de border-bottom sur les <td>
- Container : border-radius 8px, box-shadow legere, overflow-x auto${containerBorderRule}${accentRule}`
}

/**
 * Callout/encart style presets per site domain.
 * Used for "Mon Avis", "Mes Astuces", expert tips with author photo.
 * Each site has 2 styles that alternate (like tables).
 */
export interface CalloutStylePreset {
  name: string
  borderColor: string
  bgColor: string
  accentColor: string
  titleColor: string
  iconBg: string
  iconBorderColor?: string
}

export const SITE_CALLOUT_STYLES: Record<string, [CalloutStylePreset, CalloutStylePreset]> = {
  'smakk.fr': [
    {
      name: 'Avis Expert',
      borderColor: '#0A6CFF',
      bgColor: '#F0F6FC',
      accentColor: '#00052F',
      titleColor: '#00052F',
      iconBg: '#00052F',
    },
    {
      name: 'Astuce Pro',
      borderColor: '#FB8E28',
      bgColor: '#FFF8F0',
      accentColor: '#FB8E28',
      titleColor: '#00052F',
      iconBg: '#FFFFFF',
      iconBorderColor: '#FB8E28',
    },
  ],
  'mon-habitat-durable.fr': [
    {
      name: 'Avis Expert',
      borderColor: '#2D5A27',
      bgColor: '#E8F5E9',
      accentColor: '#2D5A27',
      titleColor: '#2D5A27',
      iconBg: '#2D5A27',
    },
    {
      name: 'Astuce Pro',
      borderColor: '#26BD26',
      bgColor: '#F1F8E9',
      accentColor: '#26BD26',
      titleColor: '#2D5A27',
      iconBg: '#FFFFFF',
      iconBorderColor: '#26BD26',
    },
  ],
}

export const DEFAULT_CALLOUT_STYLES: [CalloutStylePreset, CalloutStylePreset] = [
  {
    name: 'Avis Expert',
    borderColor: '#3b82f6',
    bgColor: '#eff6ff',
    accentColor: '#1e40af',
    titleColor: '#1e293b',
    iconBg: '#1e293b',
  },
  {
    name: 'Astuce Pro',
    borderColor: '#f59e0b',
    bgColor: '#fffbeb',
    accentColor: '#f59e0b',
    titleColor: '#1e293b',
    iconBg: '#FFFFFF',
    iconBorderColor: '#f59e0b',
  },
]

/**
 * Get the callout style for a given site domain and callout index.
 */
export function getCalloutStyleForSite(siteDomain: string | undefined, calloutIndex: number): CalloutStylePreset {
  const domain = siteDomain?.toLowerCase().replace(/^www\./, '') || ''
  const styles = SITE_CALLOUT_STYLES[domain] || DEFAULT_CALLOUT_STYLES
  return styles[calloutIndex % 2]
}

/**
 * Build the full callout HTML template for the AI prompt.
 */
export function buildCalloutPromptTemplate(
  style: CalloutStylePreset,
  personaName: string,
  personaRole: string,
  avatarUrl: string | null,
): string {
  const avatarBorder = style.iconBorderColor ? `border:2px solid ${style.iconBorderColor}` : `border:2px solid ${style.borderColor}`
  const avatarBg = style.iconBg
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" alt="${personaName}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;${avatarBorder}" />`
    : `<div style="width:52px;height:52px;border-radius:50%;background:${avatarBg};${avatarBorder};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.2rem;color:${style.accentColor}">${personaName.charAt(0).toUpperCase()}</div>`

  return `<div class="expert-callout" style="display:flex;gap:16px;align-items:flex-start;padding:20px 24px;background:${style.bgColor};border-left:4px solid ${style.borderColor};border-radius:8px;margin:24px 0;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="flex-shrink:0;padding-top:2px">
    ${avatarHtml}
  </div>
  <div style="flex:1;min-width:0">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
      <strong style="font-size:1rem;color:${style.titleColor}">TITRE DE L'ENCART</strong>
    </div>
    <p style="font-size:0.92rem;color:${style.accentColor};margin:0 0 4px 0;font-weight:600">${personaName} - ${personaRole}</p>
    <p style="margin:0;line-height:1.6;color:#374151">Le contenu de l'encart ici. 2-4 phrases maximum, avis tranche ou astuce actionable.</p>
  </div>
</div>`
}

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

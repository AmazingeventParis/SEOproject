// ============================================================
// Block Writer Prompt
// System + user prompt for writing ONE content block
// Writes in persona voice, integrates nuggets, outputs clean HTML
// ============================================================

import {
  SEO_EEAT_RULES,
  SEO_FAQ_RULES,
  SEO_ANTI_AI_PATTERNS,
  SEO_KEYWORD_RULES,
  SEO_INTERNAL_LINKING_RULES,
  SEO_WRITING_STYLE_RULES,
  INTENT_STRATEGIES,
} from './seo-guidelines'

interface BlockWriterParams {
  keyword: string
  searchIntent?: string
  persona: {
    name: string
    role: string
    tone_description: string | null
    bio: string | null
    writing_style_examples: Record<string, unknown>[]
  }
  block: {
    type: 'h2' | 'h3' | 'paragraph' | 'list' | 'faq' | 'callout' | 'image'
    heading: string | null
    word_count: number
    writing_directive?: string
    format_hint?: 'prose' | 'bullets' | 'table' | 'mixed'
  }
  nuggets: { id: string; content: string; tags: string[] }[]
  previousHeadings: string[]
  articleTitle: string
  internalLinkTargets?: { target_slug: string; target_title: string; suggested_anchor_context: string; is_money_page?: boolean }[]
  siteDomain?: string
  authorityLink?: { url: string; title: string; anchor_context: string } | null
  siteThemeColor?: string
}

interface BlockWriterPrompt {
  system: string
  user: string
}

/**
 * Build the system and user prompts for writing a single content block.
 *
 * The AI should return ONLY clean HTML content for the block,
 * without the heading tag itself (it will be added by the renderer).
 */
export function buildBlockWriterPrompt(
  params: BlockWriterParams
): BlockWriterPrompt {
  const { keyword, searchIntent, persona, block, nuggets, previousHeadings, articleTitle, internalLinkTargets, siteDomain, authorityLink, siteThemeColor } = params

  // ---- System prompt ----
  const system = `Tu es un redacteur web expert en SEO, specialise dans la creation de contenu de haute qualite optimise pour le referencement naturel.

## TON IDENTITE
Tu ecris en tant que "${persona.name}", ${persona.role}.${persona.tone_description ? `\nTon editorial : ${persona.tone_description}` : ''}${persona.bio ? `\nBio : ${persona.bio}` : ''}

Tu dois ecrire EXACTEMENT comme cette personne parlerait - avec sa voix, son expertise, ses expressions.

### Regles d'incarnation du persona
- Adopte le NIVEAU DE LANGUE du persona (technique, vulgarise, mixte)
- Reproduis la STRUCTURE DE PHRASE typique (courte/punchy si expert terrain, longue/analytique si academique)
- Utilise le VOCABULAIRE METIER propre au domaine du persona
- Integre des tournures personnelles : "dans mon experience", "ce que je constate souvent", "un piege classique"
- JAMAIS de formulations generiques de chatbot : "Il convient de", "Force est de constater", "Dans un premier temps"
- Si le persona a un style direct, sois direct. Si c'est un style pedagogique, explique pas a pas.

## REGLES DE REDACTION

### Style et qualite
${SEO_WRITING_STYLE_RULES}

${SEO_ANTI_AI_PATTERNS}

### SEO — Placement strategique du mot-cle
Le placement du mot-cle depend de la POSITION du bloc dans l'article :

**INTRO (premier bloc, quand aucune section precedente) :**
- Le mot-cle principal DOIT apparaitre dans les 2-3 premieres phrases (OBLIGATOIRE)
- Place-le de maniere naturelle des le debut pour signaler la pertinence a Google

**MILIEU (blocs intermediaires) :**
- Utilise des VARIANTES et SYNONYMES du mot-cle principal (pas le mot-cle exact a chaque fois)
- Enrichis avec des mots-cles secondaires et le champ semantique
- Le mot-cle principal peut apparaitre 1 fois si c'est naturel, sinon prefere les variantes

**FIN (derniers blocs avant la FAQ) :**
- Reintroduis le mot-cle principal au moins 1 fois pour renforcer la pertinence globale
- Combine avec des variantes pour un signal SEO fort en conclusion

**FAQ :**
- Integre le mot-cle principal au moins 1 fois dans l'intro ou une reponse de la FAQ

**Regles generales :**
${SEO_KEYWORD_RULES}

### E-E-A-T
${SEO_EEAT_RULES}

### Integration des nuggets
- Les nuggets sont des contenus authentiques du persona (citations, anecdotes, observations)
- Integre-les NATURELLEMENT dans le texte, comme si le persona les disait spontanement
- Ne les copie pas mot pour mot - reformule et integre de maniere fluide
- Mets les citations directes entre guillemets si appropriee

## FORMAT DE SORTIE

### Pour un bloc de type "h2" ou "h3" (section avec titre)
Ecris le contenu de la section en HTML propre.
N'inclus PAS le tag de titre (h2/h3) - il sera ajoute automatiquement.
Utilise : <p>, <strong>, <em>, <ul>/<ol>/<li>, <blockquote> si pertinent.

### Pour un bloc de type "paragraph"
Ecris un ou plusieurs paragraphes en HTML.
Utilise : <p>, <strong>, <em>.

### Pour un bloc de type "list"
Ecris une liste structuree en HTML.
Format : <ul> ou <ol> avec des <li> detailles (pas juste un mot par item).
Chaque item doit apporter de la valeur.

### Pour un bloc de type "faq"
Ecris les questions-reponses en HTML avec le format suivant :
${SEO_FAQ_RULES}
- Le H2 "FAQ" est rendu separement par le renderer, donc N'INCLUS PAS de <h2> dans le HTML

### Pour un bloc de type "callout"
Ecris un encadre informatif ou d'alerte en HTML.
Format : <div class="callout callout-info"><p>Contenu...</p></div>
Variantes : callout-info, callout-warning, callout-tip, callout-important

### Pour un format "table"
Cree un tableau HTML epure, moderne et responsive.

**Structure HTML OBLIGATOIRE :**
<div class="table-container">
  <table>
    <thead>
      <tr><th${siteThemeColor ? ` style="background-color: ${siteThemeColor}20; border-bottom: 2px solid ${siteThemeColor}50"` : ''}>En-tete</th></tr>
    </thead>
    <tbody>
      <tr><td>Donnee</td></tr>
    </tbody>
  </table>
</div>

**Design UX/UI :**
${siteThemeColor ? `Couleur theme du site : ${siteThemeColor}. Styles inline OBLIGATOIRES :
- <th> : style="background-color: ${siteThemeColor}20; border-bottom: 2px solid ${siteThemeColor}50; font-weight: 600; padding: 14px 16px"
- <td> : style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9"
- Lignes paires <tr> : style="background-color: ${siteThemeColor}08"` : 'Pas de couleur de site definie — les styles sont geres par le CSS (headers gris #f8fafc, bordures #f1f5f9).'}

**Regles strictes :**
- TOUJOURS wrapper dans <div class="table-container"> (scroll horizontal mobile + ombre legere + coins arrondis)
- Pas de bordures lourdes — uniquement border-bottom fines
- Max 4-5 colonnes pour la lisibilite mobile
- Headers courts et clairs (1-3 mots)
- Cellules concises (pas de paragraphes dans les cellules)
- Ajoute une phrase d'introduction avant le tableau si pertinent
- Le zebra-striping et le hover sont geres par le CSS — ne pas ajouter de class supplementaire

### Pour un format "mixed"
Combine prose + elements visuels (liste ou tableau) :
- Commence par 1-2 paragraphes de contexte
- Puis un tableau ou une liste structuree
- Termine par 1 paragraphe de synthese si pertinent

### Pour un format "bullets"
Structure le contenu sous forme de liste a puces ou numerotee :
- Chaque item doit etre detaille (pas juste un mot)
- Utilise <strong> pour mettre en avant le point cle de chaque item
- Ajoute une phrase d'introduction avant la liste

### Maillage interne
Si des cibles de liens internes sont fournies :
${SEO_INTERNAL_LINKING_RULES}
- Genere le HTML <a href="URL">ancre variee</a> directement dans ta sortie

### Annee de reference — REGLE ABSOLUE
Nous sommes en ${new Date().getFullYear()}. Si le contenu fait reference a une periode, une date ou une annee, utilise UNIQUEMENT ${new Date().getFullYear()}. JAMAIS 2024 ou 2025.

${searchIntent && INTENT_STRATEGIES[searchIntent]?.writing ? `## STRATEGIE D'ECRITURE — Intention "${searchIntent}"
${INTENT_STRATEGIES[searchIntent].writing}
Cette strategie PRIME sur les regles generales en cas de conflit.

` : ''}## REGLES STRICTES
- Retourne UNIQUEMENT du HTML propre, sans markdown, sans blocs de code
- Respecte EXACTEMENT le nombre de mots demande (tolerance +/- 15%)
- N'invente PAS de statistiques ou de chiffres - sois honnete
- Pas d'introduction du style "Voyons maintenant..." ou "Dans cette section..."
- Va droit au sujet`

  // ---- User prompt ----
  let user = `## MISSION
Ecris le contenu d'un bloc pour l'article intitule : "${articleTitle}"

## MOT-CLE PRINCIPAL
"${keyword}"

## BLOC A REDIGER
- Type : ${block.type}
- Titre de la section : ${block.heading || '(pas de titre - bloc de contenu libre)'}
- Nombre de mots cible : ${block.word_count} mots${searchIntent ? `\n- Intention de recherche : ${searchIntent}` : ''}

## CONTEXTE - Sections precedentes de l'article
L'article contient deja les sections suivantes avant ce bloc :`

  if (previousHeadings.length > 0) {
    for (const heading of previousHeadings) {
      user += `\n- ${heading}`
    }
  } else {
    user += `\n(Ce bloc est le premier de l'article)`
  }

  // Add nuggets to integrate
  if (nuggets.length > 0) {
    user += `\n\n## NUGGETS A INTEGRER
Les nuggets suivants doivent etre integres naturellement dans ce bloc :`

    for (const nugget of nuggets) {
      user += `\n\n### Nugget [${nugget.id}]`
      user += `\nTags: ${nugget.tags.join(', ') || 'aucun'}`
      user += `\nContenu: "${nugget.content}"`
    }

    user += `\n\nIntegre chaque nugget de maniere fluide dans le texte. Le lecteur ne doit pas sentir qu'il s'agit d'un element "plaque" - cela doit couler naturellement.`
  }

  // Inject writing style examples as few-shot references
  if (persona.writing_style_examples && persona.writing_style_examples.length > 0) {
    user += `\n\n## EXEMPLES DU STYLE D'ECRITURE DE ${persona.name.toUpperCase()}
Voici des extraits authentiques. Imite ce style, ce vocabulaire, cette structure de phrase :`
    for (const example of persona.writing_style_examples.slice(0, 3)) {
      const text = (example as Record<string, unknown>).text || (example as Record<string, unknown>).content || JSON.stringify(example)
      user += `\n\n---\n${String(text).slice(0, 600)}\n---`
    }
    user += `\n\nCes extraits sont ta REFERENCE STYLISTIQUE. Le texte que tu produis doit sembler ecrit par la meme personne.`
  }

  // Inject writing directive if available
  if (block.writing_directive || block.format_hint) {
    user += `\n\n## DIRECTIVE D'ECRITURE POUR CE BLOC`
    if (block.writing_directive) {
      user += `\n${block.writing_directive}`
    }
    if (block.format_hint) {
      user += `\nFormat recommande : ${block.format_hint}`
    }
  }

  // Inject internal link targets if available
  if (internalLinkTargets && internalLinkTargets.length > 0) {
    user += `\n\n## LIENS INTERNES A INTEGRER`
    for (const link of internalLinkTargets) {
      const fullUrl = siteDomain ? `https://${siteDomain}/${link.target_slug.replace(/^\//, '')}` : `/${link.target_slug}`
      user += `\n- Cible : "${link.target_title}" → ${fullUrl}`
      user += `\n  Contexte : ${link.suggested_anchor_context}`
      if (link.is_money_page) {
        user += `\n  (Page prioritaire)`
      }
    }
    user += `\nIMPORTANT : L'ancre doit etre UNIQUE et NATURELLE — pas le titre exact.`
  }

  // Inject authority link if provided
  if (authorityLink) {
    user += `\n\n## LIEN D'AUTORITE EXTERNE
- Source : "${authorityLink.title}" → ${authorityLink.url}
- Contexte : ${authorityLink.anchor_context}
Integre ce lien EXTERNE naturellement (1 seule fois, ancre descriptive).
Ce lien renforce l'E-E-A-T en citant une source reconnue.`
  }

  // Determine keyword placement instruction based on block position
  let keywordInstruction: string
  if (previousHeadings.length === 0 && block.type === 'paragraph') {
    keywordInstruction = `- OBLIGATOIRE : place le mot-cle principal "${keyword}" dans les 2-3 premieres phrases (intro de l'article)
- BLOC INTRO : max 140 mots STRICT. 1-2 <p> uniquement. Pas de liste, pas de titre.
- Le lecteur doit immediatement savoir qu'il est au bon endroit. Identifie la cible (qui est concerne).
- Inclus UNE phrase explicite de validation d'intention : ce que le lecteur va apprendre ou resoudre en lisant cet article.
- Phrases courtes, percutantes. Une idee par phrase. Zero fluff, zero formule generique.`
  } else if (previousHeadings.length === 0) {
    keywordInstruction = `- OBLIGATOIRE : place le mot-cle principal "${keyword}" dans les 2-3 premieres phrases (intro de l'article)`
  } else if (block.type === 'faq') {
    keywordInstruction = `- Integre le mot-cle principal "${keyword}" au moins 1 fois dans l'intro ou une reponse de la FAQ`
  } else {
    keywordInstruction = `- Utilise des variantes et synonymes du mot-cle "${keyword}". Mot-cle principal au moins 1 fois si c'est un des derniers blocs de l'article`
  }

  user += `\n\n## RAPPEL
- Ecris exactement ~${block.word_count} mots
- Type de bloc : ${block.type}${block.format_hint ? ` (format: ${block.format_hint})` : ''}
- Retourne UNIQUEMENT du HTML propre
- Ecris en tant que ${persona.name} (${persona.role})
${keywordInstruction}`

  return { system, user }
}

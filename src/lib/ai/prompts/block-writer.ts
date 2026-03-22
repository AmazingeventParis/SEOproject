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
  getTableStyleForSite,
  buildTablePromptTemplate,
  buildTableStyleRules,
  getCalloutStyleForSite,
  buildCalloutPromptTemplate,
} from './seo-guidelines'

interface BlockWriterParams {
  keyword: string
  searchIntent?: string
  persona: {
    name: string
    role: string
    tone_description: string | null
    bio: string | null
    avatar_reference_url: string | null
    writing_style_examples: Record<string, unknown>[]
  }
  block: {
    type: 'h2' | 'h3' | 'h4' | 'paragraph' | 'list' | 'faq' | 'callout' | 'image'
    heading: string | null
    word_count: number
    writing_directive?: string
    format_hint?: 'prose' | 'bullets' | 'table' | 'mixed'
  }
  nuggets: { id: string; content: string; tags: string[] }[]
  previousHeadings: string[]
  previousBlockContent?: string
  articleDigest?: string
  articleTitle: string
  internalLinkTargets?: { target_slug: string; target_title: string; suggested_anchor_context: string; is_money_page?: boolean }[]
  siteDomain?: string
  authorityLink?: { url: string; title: string; anchor_context: string } | null
  tableStyleIndex?: number
  calloutStyleIndex?: number
  blockPosition?: 'early' | 'middle' | 'late'
  totalBlocks?: number
  articleOutline?: string
  blockKeyIdeas?: string[]
  productComparison?: {
    products: { name: string; brand: string | null; price: number | null; price_label: string | null; rating: number | null; rating_scale: number; verdict: string | null; pros: string[]; cons: string[]; specs: { criterion_id: string; value: string; rating: string }[]; affiliate_url: string | null; affiliate_enabled: boolean }[]
    criteria: { id: string; name: string; unit: string | null }[]
  }
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
  const { keyword, searchIntent, persona, block, nuggets, previousHeadings, previousBlockContent, articleDigest, articleTitle, internalLinkTargets, siteDomain, authorityLink, tableStyleIndex, calloutStyleIndex, blockPosition, articleOutline, blockKeyIdeas } = params

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
- ANCRAGE BIO OBLIGATOIRE : si la bio du persona mentionne un contexte precis (type de logement, situation, parcours, localisation), tu DOIS y faire reference au moins 1 fois dans l'article. Ce vecu concret est la preuve de l'expertise E-E-A-T.

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

### Pour un bloc de type "h2", "h3" ou "h4" (section avec titre)
Ecris le contenu de la section en HTML propre.
N'inclus PAS le tag de titre (h2/h3/h4) - il sera ajoute automatiquement.
Utilise : <p>, <strong>, <em>, <ul>/<ol>/<li>, <blockquote> si pertinent.

### Pour un bloc de type "paragraph"
Ecris un ou plusieurs paragraphes en HTML.
Utilise : <p>, <strong>, <em>.

### Pour un bloc de type "list"
Ecris une liste structuree en HTML.
Format : <ul> ou <ol> avec des <li> detailles (pas juste un mot par item).
Chaque item doit apporter de la valeur.

### Pour un bloc de type "faq"
Ecris le bloc FAQ COMPLET avec le H2 et les questions-reponses en HTML :
${SEO_FAQ_RULES}
- Le H2 DOIT etre inclus dans le HTML genere (ex: <h2>Questions frequentes</h2> ou <h2>FAQ</h2>)

### Pour un bloc de type "callout"
Ecris un encadre informatif, d'alerte ou d'avis expert en HTML.

**Encadres simples (info, warning) :**
Format : <div class="callout callout-info"><p>Contenu...</p></div>
Variantes : callout-info, callout-warning, callout-tip, callout-important

**Encadres expert avec photo auteur ("Mon Avis", "Mes Astuces", "Conseil d'expert") :**
Utilise ce format des que le contenu est un AVIS PERSONNEL, une ASTUCE du persona, ou un CONSEIL D'EXPERT.
Les styles inline sont OBLIGATOIRES (publication WordPress sans CSS custom).

${(() => {
  const calloutStyle = getCalloutStyleForSite(siteDomain, calloutStyleIndex ?? 0)
  return `**Style d'encart a utiliser : "${calloutStyle.name}"**

**Structure HTML OBLIGATOIRE (copie ce modele exactement) :**
${buildCalloutPromptTemplate(calloutStyle, persona.name, persona.role, persona.avatar_reference_url)}

**Regles des encarts expert :**
- MAXIMUM 3 encarts expert par article entier. ${(calloutStyleIndex ?? 0) >= 3 ? 'LIMITE ATTEINTE — NE GENERE AUCUN encart expert dans ce bloc.' : `Il y en a deja ${calloutStyleIndex ?? 0} dans les blocs precedents — il en reste ${3 - (calloutStyleIndex ?? 0)} maximum.`}
- Le TITRE varie selon le contexte : "Mon avis", "L'astuce de ${persona.name}", "Mon conseil", "Ce que je recommande", "A retenir"
- Contenu COURT : 2-4 phrases max, avis TRANCHE ou astuce ACTIONABLE
- Le nom et role du persona sont affiches automatiquement — ne les repete pas dans le texte
- Styles inline OBLIGATOIRES sur CHAQUE element (div, img, p, strong)
- Reserve les encarts aux moments ESSENTIELS : avis tranche sur un sujet controverse, astuce pratique tres utile, mise en garde importante basee sur l'experience
- NE PAS ajouter un encart si le contenu n'apporte pas un avis FORT ou une astuce VRAIMENT actionable`
})()}

### Pour un format "table"
Cree un tableau HTML epure, moderne et responsive. Les styles inline sont OBLIGATOIRES car le HTML sera publie sur WordPress sans CSS custom.

${(() => {
  const tableStyle = getTableStyleForSite(siteDomain, tableStyleIndex ?? 0)
  return `**Style de tableau a utiliser : "${tableStyle.name}"**

**Structure HTML OBLIGATOIRE (copie ce modele exactement) :**
${buildTablePromptTemplate(tableStyle)}

**Regles de style :**
${buildTableStyleRules(tableStyle)}`
})()}

**Regles strictes :**
- TOUJOURS wrapper dans <div class="table-container" style="...">
- Styles inline OBLIGATOIRES sur CHAQUE <th>, <td>, <tr> pair et <div> — jamais compter sur le CSS externe
- Max 4-5 colonnes pour la lisibilite mobile
- Headers courts et clairs (1-3 mots)
- Cellules concises (pas de paragraphes dans les cellules)
- Ajoute une phrase d'introduction avant le tableau si pertinent

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
- Le nombre de mots indique est un OBJECTIF MINIMUM STRICT. Tu DOIS ecrire au moins ce nombre de mots. Ecris plus si le sujet le merite, mais JAMAIS moins. Un bloc de 250 mots qui n'en produit que 120 est une ERREUR GRAVE. Ne t'arrete PAS tant que tu n'as pas atteint l'objectif minimum.
- N'invente PAS de statistiques ou de chiffres - sois honnete
- Pas d'introduction du style "Voyons maintenant..." ou "Dans cette section..."
- Va droit au sujet
- PERTINENCE ABSOLUE — REGLE LA PLUS IMPORTANTE :
  * Chaque phrase DOIT etre directement liee au mot-cle principal "${keyword}" et au titre de l'article
  * Si une phrase ne repond pas a la question "est-ce que cela parle SPECIFIQUEMENT de ${keyword} ?" → SUPPRIME-LA
  * N'aborde JAMAIS de sujet connexe, voisin ou tangentiel meme s'il partage le meme domaine
  * Si la directive d'ecriture ou le heading mentionne un sous-sujet precis, reste STRICTEMENT sur ce sous-sujet
  * Avant de valider chaque paragraphe, verifie : "est-ce que ce paragraphe concerne bien ${keyword} et rien d'autre ?"
- AERATION OBLIGATOIRE — ZERO MUR DE TEXTE :
  * JAMAIS plus de 2 paragraphes <p> consecutifs sans un element visuel (liste, tableau, callout)
  * Si tu enumeres 3+ elements, avantages, etapes, criteres ou conseils → utilise une liste <ul> ou <ol> avec <strong> sur le point cle de chaque <li>
  * Si tu compares 2+ options, presentes des donnees chiffrees, ou listes des specs/prix/criteres → utilise un TABLEAU HTML avec les styles inline definis ci-dessus (voir section "format table")
  * Chaque section de 200+ mots DOIT contenir au moins 1 element structurant (liste OU tableau)
  * Chaque section de 350+ mots DOIT contenir au moins 1 tableau ET 1 liste (ou 2 listes)
  * Le lecteur doit pouvoir SCANNER la page et trouver l'info cle visuellement, sans tout lire
  * Les listes et tableaux ne remplacent PAS le texte — ils le completent. Ajoute 1-2 phrases de contexte avant chaque element visuel`

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

  // Inject full article outline for MECE context
  if (articleOutline) {
    user += `\n\n## PLAN COMPLET DE L'ARTICLE
${articleOutline}`
  }

  // Inject key_ideas for this specific block (MECE scope)
  if (blockKeyIdeas && blockKeyIdeas.length > 0) {
    user += `\n\n## PERIMETRE EXCLUSIF DE CETTE SECTION
Tu DOIS traiter UNIQUEMENT ces idees cles (et rien d'autre) :
${blockKeyIdeas.map(idea => `- ${idea}`).join('\n')}
Tout point non liste ici appartient a une AUTRE section. Ne l'aborde PAS.`
  }

  // Inject the content of the immediately preceding block for coherence
  if (previousBlockContent) {
    // Strip HTML tags — use full text up to 3000 chars for better transition context
    const plainPrevious = previousBlockContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)
    user += `\n\n## TEXTE INTEGRAL DE LA SECTION PRECEDENTE
---
${plainPrevious}
---`
  }

  // Inject cumulative article digest (all sections written so far)
  if (articleDigest) {
    user += `\n\n## RESUME CUMULATIF DE L'ARTICLE (toutes les sections deja ecrites)
${articleDigest}
---
REGLE ANTI-REDITE ABSOLUE (CRITIQUE — une redite = echec de la section) :
- Chaque idee, exemple, chiffre, conseil ou formulation listee ci-dessus est DEJA dans l'article
- Tu ne dois JAMAIS repeter, reformuler ou paraphraser ces elements — meme avec des mots differents
- Si un concept a ete explique (ex: "qualite reflex"), ne le re-explique PAS, fais-y reference en 3 mots max et passe a autre chose
- Apporte des idees NOUVELLES, des angles DIFFERENTS, des informations COMPLEMENTAIRES
- Si tu n'as rien de nouveau a dire sur un point, PASSE AU SUIVANT — mieux vaut un bloc plus court que repetitif`
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

    user += `\n\nREGLES D'INTEGRATION DES NUGGETS :
- Integre chaque nugget de maniere fluide dans le texte. Le lecteur ne doit pas sentir qu'il s'agit d'un element "plaque".
- GARDE-FOU PERTINENCE : si un nugget n'a AUCUN rapport direct avec le sujet "${keyword}" ou le heading de cette section, IGNORE-LE completement. Ne l'integre PAS. Un nugget hors-sujet est pire que pas de nugget du tout.
- JAMAIS de copie mot pour mot — reformule et adapte au contexte de la section.`
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
    user += `\n\n## LIENS INTERNES (optionnels — a placer UNIQUEMENT si naturel)`
    for (const link of internalLinkTargets) {
      // Support both formats: {target_slug} (standard pipeline) and {url} (revamp pipeline)
      const rawUrl = (link as Record<string, unknown>).url as string | undefined
      const fullUrl = rawUrl
        ? rawUrl
        : siteDomain
          ? `https://${siteDomain}/${(link.target_slug || '').replace(/^\//, '')}`
          : `/${link.target_slug || ''}`
      user += `\n- URL : ${fullUrl}`
      if (link.is_money_page) {
        user += ` (page prioritaire)`
      }
    }
    user += `\n
REGLES STRICTES DU MAILLAGE :
- Un lien = UNE balise <a> sur 2-6 mots dans une phrase qui parle DEJA de "${keyword}"
- INTERDIT d'ecrire une phrase ou un paragraphe pour introduire le sujet de l'article cible
- INTERDIT de changer de sujet, de faire une analogie ou une transition vers un autre domaine pour justifier un lien
- Si aucune phrase de cette section ne permet de placer le lien naturellement → NE LE PLACE PAS. C'est OK.
- Le lecteur ne doit PAS remarquer que le lien a ete place intentionnellement`
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

  // Condensation instruction based on block position in article
  if (blockPosition === 'late') {
    user += `\n\n## CONDENSATION — DERNIER TIERS DE L'ARTICLE (CRITIQUE)
Ce bloc est dans le DERNIER TIERS de l'article. Le lecteur a deja eu la reponse principale.
- Sois CONCIS et DIRECT : va a l'essentiel, pas de developpements longs
- Chaque phrase doit apporter une info NOUVELLE en peu de mots
- Paragraphes de 1-2 lignes max. Listes a puces plutot que prose longue
- Pas de contexte, pas de rappel, pas d'introduction de section — attaque directement le point
- Le word_count indique est un MAXIMUM a ne pas depasser (pas un minimum)
- Si tu peux dire la meme chose en moins de mots, FAIS-LE`
  } else if (blockPosition === 'middle') {
    user += `\n\n## RYTHME — MILIEU D'ARTICLE
Ce bloc est dans la partie intermediaire de l'article. Approfondis le sujet mais reste concentre.
- Bon equilibre entre detail et concision
- Paragraphes courts (2-3 lignes)
- Chaque phrase doit apporter de la valeur — zero remplissage`
  }

  // Inject product comparison data for comparison intent
  const { productComparison } = params
  if (productComparison && productComparison.products.length > 0) {
    user += `\n\n## DONNEES PRODUITS (UTILISE EXCLUSIVEMENT CES DONNEES)

⚠️ REGLE ABSOLUE : NE PAS inventer de specs, prix, notes ou avantages non fournis.
Utilise UNIQUEMENT les donnees ci-dessous. Si une donnee manque, omets-la.

### Criteres : ${productComparison.criteria.map(c => c.name + (c.unit ? ` (${c.unit})` : '')).join(', ')}`

    for (const p of productComparison.products) {
      user += `\n\n**${p.name}**${p.brand ? ` — ${p.brand}` : ''}`
      if (p.price != null) user += ` | Prix: ${p.price_label || `${p.price} EUR`}`
      if (p.rating != null) user += ` | Note: ${p.rating}/${p.rating_scale}`
      const specsWithValues = p.specs.filter(s => s.value)
      if (specsWithValues.length > 0) {
        for (const s of specsWithValues) {
          const criterion = productComparison.criteria.find(c => c.id === s.criterion_id)
          if (criterion) user += `\n  ${criterion.name}: ${s.value} [${s.rating}]`
        }
      }
      if (p.pros.length > 0) user += `\n  + ${p.pros.join(' | ')}`
      if (p.cons.length > 0) user += `\n  - ${p.cons.join(' | ')}`
      if (p.verdict) user += `\n  Verdict: ${p.verdict}`
    }

    // Color coding instructions for table blocks
    if (block.format_hint === 'table') {
      user += `\n\n### CODE COULEUR TABLEAU COMPARATIF (STYLES INLINE OBLIGATOIRES)
Pour chaque cellule <td> du tableau qui contient une spec :
- rating "above" → style="background:#dcfce7;color:#166534;font-weight:600;padding:8px 12px"
- rating "average" → style="background:#fef9c3;color:#854d0e;padding:8px 12px"
- rating "below" → style="background:#fee2e2;color:#991b1b;font-weight:600;padding:8px 12px"
Pour le <thead> : style="background:#f1f5f9;font-weight:700;padding:10px 12px;text-align:center"
Pour le <table> : style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0"
Chaque <td> et <th> doit avoir style="border:1px solid #e2e8f0" en plus des couleurs.`
    }

    // Affiliate link instructions
    const affiliateProducts = productComparison.products.filter(p => p.affiliate_enabled && p.affiliate_url)
    if (affiliateProducts.length > 0) {
      user += `\n\n### LIENS D'AFFILIATION
Apres le tableau comparatif OU dans la section verdict, insere un bouton CTA pour chaque produit affilie :
<a href="URL" rel="nofollow sponsored" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;margin:4px">Voir le prix — NomProduit</a>

Produits affilies :
${affiliateProducts.map(p => `- ${p.name} → ${p.affiliate_url}`).join('\n')}

Pour les produits SANS lien d'affiliation, NE PAS generer de CTA.`
    }
  }

  user += `\n\n## 4 REGLES STRICTES
**REGLE 1 — TRANSITION** : La premiere phrase doit creer un pont naturel avec la section precedente. Pas de "Voyons maintenant", mais une transition logique qui montre pourquoi on passe a ce nouveau point.
**REGLE 2 — ZERO REDITE** : Ne repete AUCUN argument, exemple, chiffre ou conseil deja present dans les sections precedentes (voir le plan et le texte de la section precedente). Si un point a deja ete traite, passe-le. Apporte uniquement des idees NOUVELLES.
**REGLE 3 — PAS DE CONCLUSION** : Ne conclus PAS cette section. Pas de phrase de synthese en fin de section ("En resume...", "Ainsi...", "En definitive..."). La derniere phrase doit rester dans le vif du sujet ou ouvrir vers la section suivante.
**REGLE 4 — DENSITE MAXIMALE** : Chaque phrase doit apporter une information NOUVELLE ou une valeur concrete. Supprime mentalement toute phrase qui ne fait que "remplir" ou reformuler ce qui a deja ete dit dans le meme bloc. Un paragraphe de 2-3 lignes percutantes vaut mieux qu'un paragraphe de 6 lignes dilue. Objectif : zero phrase inutile.

## RAPPEL
- Objectif : ~${block.word_count} mots — c'est une CIBLE, pas un minimum. Si tu peux transmettre toute l'info en moins de mots, FAIS-LE. Un bloc concis et dense est meilleur qu'un bloc long et dilue.
- Type de bloc : ${block.type}${block.format_hint ? ` (format: ${block.format_hint})` : ''}
- Retourne UNIQUEMENT du HTML propre
- Ecris en tant que ${persona.name} (${persona.role})
${keywordInstruction}
- GARDE-FOU FINAL : relis mentalement chaque paragraphe. Si un seul paragraphe parle d'autre chose que "${keyword}" / "${articleTitle}", reecris-le ou supprime-le. ZERO tolerance pour le hors-sujet.`

  return { system, user }
}

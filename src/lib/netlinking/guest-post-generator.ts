// ============================================================
// Guest Post Article Generator
// Creates high-quality articles for external sites (netlinking)
// Dual output: HTML + plain text for copy-paste
// Uses the same writing quality rules as the main pipeline
// ============================================================

import { routeAI } from '@/lib/ai/router'
import {
  SEO_EEAT_RULES,
  SEO_ANTI_AI_PATTERNS,
  SEO_WRITING_STYLE_RULES,
} from '@/lib/ai/prompts/seo-guidelines'
import type { GeneratedArticle, GuestPostConfig, GuestPostLink } from './types'

function extractJson(raw: string): string {
  let text = raw.trim()
  // Strip markdown code fences
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fence) text = fence[1].trim()
  // Find first { and last }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) {
    console.error('[guest-post] No JSON found in AI response (first 500 chars):', raw.slice(0, 500))
    throw new Error('Pas de JSON dans la reponse IA')
  }
  let json = text.slice(start, end + 1)
  // Fix trailing commas
  json = json.replace(/,\s*([}\]])/g, '$1')
  return json
}

function htmlToPlainText(html: string): string {
  let text = html
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)')
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**')
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*')
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1')
  text = text.replace(/<[^>]*>/g, '')
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}

function buildLinksSection(links: GuestPostLink[]): string {
  const targetLinks = links.filter(l => l.type === 'target')
  const authorityLinks = links.filter(l => l.type === 'authority')

  let section = `\n## LIENS A INTEGRER (${links.length} lien(s) — OBLIGATION STRICTE)\n`

  if (targetLinks.length > 0) {
    section += `\n### Lien(s) cible (backlink) — PRIORITE ABSOLUE :\n`
    for (const link of targetLinks) {
      section += `- URL : ${link.url}\n`
      section += `  Ancre EXACTE a utiliser : "${link.anchorText}"\n`
      section += `  Ce lien DOIT etre integre naturellement dans le corps de l'article (JAMAIS en conclusion, JAMAIS en introduction).\n`
      section += `  La phrase qui contient le lien doit parler du SUJET du lien de facon naturelle.\n\n`
    }
  }

  if (authorityLinks.length > 0) {
    section += `\n### Lien(s) d'autorite (appui) :\n`
    for (const link of authorityLinks) {
      section += `- URL : ${link.url}\n`
      section += `  Ancre : "${link.anchorText}"\n`
      section += `  Ce lien renforce la credibilite de l'article. Integre-le pour appuyer un argument factuel.\n\n`
    }
  }

  section += `REGLES D'INTEGRATION DES LIENS :
- Chaque lien = UNE balise <a href="URL">ancre</a> dans une phrase naturelle
- L'ancre doit etre EXACTEMENT le texte indique ci-dessus (pas de modification)
- Le lien cible doit etre place dans le 2eme ou 3eme tiers de l'article (JAMAIS au debut, JAMAIS en conclusion)
- Les liens d'autorite peuvent etre places n'importe ou dans le corps
- Le lecteur ne doit PAS sentir que les liens ont ete places intentionnellement
- Si l'article parle d'un sujet lie au lien, integre-le dans CE contexte naturellement`

  return section
}

/**
 * Generate a high-quality guest post article for netlinking.
 * Uses the same writing quality standards as the main pipeline.
 */
export async function generateGuestPostArticle(
  config: GuestPostConfig
): Promise<GeneratedArticle> {
  const wordCount = config.wordCount || 800
  const currentYear = new Date().getFullYear()

  let anchorGuidance = ''
  if (config.anchorProfile) {
    const { exact, broad, brand } = config.anchorProfile
    const total = exact + broad + brand || 1
    if (exact / total > 0.4) anchorGuidance = '\n⚠️ Le profil d\'ancres du site a trop d\'ancres exactes. Si possible, privilegier une ancre large ou de marque.'
    else if (brand / total < 0.1) anchorGuidance = '\n💡 Le profil manque d\'ancres de marque. Une ancre de marque serait benefique.'
  }

  const linksSection = buildLinksSection(config.links)

  const systemPrompt = `Tu es un redacteur web expert en SEO, specialise dans la creation d'articles invites (guest posts) de haute qualite pour le netlinking.

## TON ROLE
Tu rediges un article qui sera publie sur un site EXTERNE. L'article doit etre suffisamment bon pour que le webmaster l'accepte sans modification. Ce n'est PAS un article promotionnel — c'est un vrai article de valeur avec un lien integre naturellement.

## ANNEE EN COURS : ${currentYear}

## REGLES DE REDACTION

### Style et qualite
${SEO_WRITING_STYLE_RULES}

${SEO_ANTI_AI_PATTERNS}

### E-E-A-T
${SEO_EEAT_RULES}

### MISE EN GRAS STRATEGIQUE (OBLIGATOIRE)
Chaque paragraphe <p> de 2+ phrases DOIT contenir au moins 1 balise <strong> sur un terme important :
- Mots-cles, termes techniques, noms de marques, chiffres cles, conseils actionables
- Ne mets PAS en gras des mots vides — uniquement des GROUPES DE 1 A 4 MOTS significatifs
- Vise 2-3 occurrences de <strong> par tranche de 150 mots

### NUANCE ET CONTRADICTION — STYLE "OUI, MAIS"
L'article doit contenir au moins 1 nuance :
- "C'est vrai dans la majorite des cas, mais attention si..."
- "Sur le papier c'est seduisant. En pratique, [contrepartie]"
- "Oui, [avantage]. Mais il faut aussi compter avec [limite]"

### VARIANTES NATURELLES DU MOT-CLE
- INTERDIT de copier la requete exacte plus de 2 fois dans tout l'article
- Reformule TOUJOURS en langage naturel avec articles et prepositions
- Varie les formes : nominale, verbale, adjectivale, interrogative

### STRUCTURE OBLIGATOIRE
- Titre H1 accrocheur (50-70 caracteres), contient le mot-cle ou une variante
- Introduction percutante (80-120 mots) : accroche + promesse de valeur. PAS de definition.
- 4-5 sections H2 avec des titres SEO (mot-cle ou variante + qualificateur concret)
- Chaque H2 commence par une ACCROCHE (chiffre, question, constat, anecdote) — JAMAIS par "Le/La/Les..."
- Au moins 2 listes a puces dans l'article (avec emojis sur chaque <li>)
- Au moins 1 element en gras par paragraphe de prose
- Paragraphes courts : 2-3 phrases max, jamais de mur de texte
- Chaque section H2 : au moins 1 phrase de 4 mots ou moins
- Au moins 2 "vous/votre" par section H2
- PAS DE CONCLUSION : la derniere section traite un sujet concret, pas un resume

### FORMAT HTML
- Utilise uniquement : <h2>, <p>, <strong>, <em>, <ul>/<ol>/<li>, <a href="...">
- PAS de <h1> dans le content_html (le titre H1 est dans le champ "title")
- Les listes doivent avoir style="font-size:1.125rem;line-height:1.8" et chaque <li> style="margin-bottom:8px;font-size:1.125rem"
- Chaque <li> commence par un emoji pertinent : ✅, 💡, ⚠️, 📊, 🔧, 💰, 🎯, etc.`

  const userPrompt = `## MISSION
Redige un article de ${wordCount} mots en francais pour publication sur le site "${config.vendorDomain}" (niche : ${config.vendorNiche || 'generaliste'}).

## MOT-CLE PRINCIPAL
"${config.targetKeyword}"

## SITE CIBLE (celui qui recoit le backlink)
${config.siteDomain} — niche "${config.siteNiche}"
${anchorGuidance}

${linksSection}

## CONSIGNES SPECIFIQUES
- L'article est destine aux LECTEURS de ${config.vendorDomain}, pas aux lecteurs de ${config.siteDomain}
- Le sujet doit etre coherent avec la niche "${config.vendorNiche || 'generaliste'}" du site vendeur
- Le lien backlink doit s'integrer dans un paragraphe qui parle DEJA du sujet lie — pas dans une transition forcee
- Ecris comme un expert du domaine qui partage ses connaissances, pas comme un commercial

## CHECKLIST FINALE (verifie AVANT de retourner le JSON)
1. Le titre H1 contient le mot-cle ou une variante ? ✓
2. L'intro accroche (pas de definition plate) ? ✓
3. Chaque H2 commence par une accroche (chiffre, question, constat) ? ✓
4. Au moins 1 phrase ≤4 mots par section H2 ? ✓
5. Au moins 2 "vous/votre" par section ? ✓
6. Au moins 2 listes <ul> avec emojis dans l'article ? ✓
7. <strong> sur les termes cles dans chaque paragraphe ? ✓
8. Le(s) lien(s) sont integres naturellement ? ✓
9. Au moins 1 nuance "oui, mais" dans l'article ? ✓
10. Pas de conclusion "en resume..." ? ✓
11. Le nombre de mots est respecte (${wordCount} mots minimum) ? ✓

## FORMAT DE SORTIE
Retourne UNIQUEMENT un JSON valide, sans texte avant ou apres :
{
  "title": "Titre H1 de l'article (50-70 caracteres)",
  "content_html": "<h2>Premier H2 accrocheur</h2><p>Contenu HTML complet...</p>",
  "word_count": ${wordCount},
  "anchors": [
    {"type": "exact|broad|brand", "text": "texte de l'ancre utilisee", "context_sentence": "La phrase complete contenant le lien avec la balise <a>."}
  ]
}

Le content_html doit contenir l'article COMPLET (${wordCount}+ mots) avec H2, p, strong, ul/li, a href, emojis sur les listes.`

  // Try up to 2 times (AI sometimes returns invalid JSON on first attempt)
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await routeAI('generate_netlinking_article', [
        { role: 'user', content: userPrompt },
      ], systemPrompt)

      const result = JSON.parse(extractJson(response.content)) as GeneratedArticle

      // Add target info
      result.target_url = config.links.find(l => l.type === 'target')?.url || ''
      result.target_keyword = config.targetKeyword

      // Generate plain text version
      result.content_text = htmlToPlainText(`<h1>${result.title}</h1>\n${result.content_html}`)

      return result
    } catch (err) {
      lastError = err as Error
      console.warn(`[guest-post] Attempt ${attempt + 1} failed: ${lastError.message}`)
    }
  }

  throw lastError || new Error('Echec de la generation apres 2 tentatives')
}

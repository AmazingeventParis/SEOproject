// ============================================================
// Guest Post Article Generator
// Creates high-quality articles for external sites (netlinking)
// Dual output: HTML + plain text for copy-paste
// ============================================================

import { routeAI } from '@/lib/ai/router'
import type { GeneratedArticle, GuestPostConfig, GuestPostLink } from './types'

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Pas de JSON dans la reponse IA')
  return cleaned.slice(start, end + 1)
}

function htmlToPlainText(html: string): string {
  let text = html
  // Convert headings to markdown-style
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
  // Convert links to [text](url)
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)')
  // Convert bold
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**')
  // Convert italic
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*')
  // Convert list items
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1')
  // Remove remaining tags
  text = text.replace(/<[^>]*>/g, '')
  // Clean up whitespace
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

  let anchorGuidance = ''
  if (config.anchorProfile) {
    const { exact, broad, brand } = config.anchorProfile
    const total = exact + broad + brand || 1
    if (exact / total > 0.4) anchorGuidance = '\n⚠️ Le profil d\'ancres du site a trop d\'ancres exactes. Si possible, privilegier une ancre large ou de marque.'
    else if (brand / total < 0.1) anchorGuidance = '\n💡 Le profil manque d\'ancres de marque. Une ancre de marque serait benefique.'
  }

  const linksSection = buildLinksSection(config.links)

  const prompt = `Tu es un redacteur web expert specialise dans la redaction d'articles invites (guest posts) pour le netlinking SEO.

## MISSION
Redige un article de ${wordCount} mots en francais pour publication sur le site "${config.vendorDomain}" (niche : ${config.vendorNiche || 'generaliste'}).

## OBJECTIF
L'article doit :
1. Apporter une VRAIE valeur au lecteur du site vendeur (pas un article promo)
2. Etre coherent avec la thematique du site vendeur
3. Integrer naturellement le(s) lien(s) backlink vers ${config.siteDomain}
4. Etre suffisamment qualitatif pour etre accepte par le webmaster sans modification

## MOT-CLE PRINCIPAL
"${config.targetKeyword}"

## SITE CIBLE (le tien)
${config.siteDomain} — niche "${config.siteNiche}"
${anchorGuidance}

${linksSection}

## REGLES DE REDACTION QUALITE

### Structure
- Titre H1 accrocheur et informatif (pas commercial)
- 3-4 sections H2 bien structurees
- Paragraphes courts (2-3 phrases)
- Au moins 1 liste a puces dans l'article

### Style anti-IA
- Varie la longueur des phrases (courtes percutantes + moyennes developpees)
- Utilise des transitions orales : "Concretement,", "Du coup,", "Autre point :"
- Au moins 1 phrase de 4 mots ou moins par section
- Interpelle le lecteur avec "vous/votre"
- Ton expert et accessible, pas formel ni robotique
- Mets en <strong> les termes cles importants (2-3 par section)

### SEO
- Le mot-cle "${config.targetKeyword}" doit apparaitre naturellement 2-3 fois (variantes incluses)
- Pas de keyword stuffing — ecris pour le lecteur d'abord
- Le titre doit contenir le mot-cle ou une variante proche

### Ce qui est INTERDIT
- Ne mentionne JAMAIS que c'est un article sponsorise ou un partenariat
- Ne commence PAS par une definition Wikipedia
- Pas de "dans cet article nous allons voir..."
- Pas de conclusion bateau "en resume..."
- Pas de formulations IA : "il convient de", "force est de constater", "dans un premier temps"

## FORMAT DE SORTIE
Retourne UNIQUEMENT un JSON valide :
{
  "title": "Titre H1 de l'article",
  "content_html": "<h2>Section 1</h2><p>Contenu HTML complet avec les liens <a href=\\"url\\">ancre</a> integres...</p>",
  "word_count": ${wordCount},
  "anchors": [
    {"type": "exact", "text": "ancre utilisee", "context_sentence": "La phrase complete contenant le lien."}
  ]
}

Le content_html doit contenir l'article COMPLET avec les balises H2, p, strong, ul/li, et les liens <a> deja integres aux bons endroits.`

  const response = await routeAI('generate_netlinking_article', [{ role: 'user', content: prompt }])
  const result = JSON.parse(extractJson(response.content)) as GeneratedArticle

  // Add target info
  result.target_url = config.links.find(l => l.type === 'target')?.url || ''
  result.target_keyword = config.targetKeyword

  // Generate plain text version
  result.content_text = htmlToPlainText(`<h1>${result.title}</h1>\n${result.content_html}`)

  return result
}

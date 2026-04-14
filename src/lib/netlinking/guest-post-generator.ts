// ============================================================
// Guest Post Article Generator
// Creates high-quality articles for external sites (netlinking)
// Dual output: HTML + plain text for copy-paste
// Uses the same writing quality rules as the main pipeline
// ============================================================

import { routeAI } from '@/lib/ai/router'
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

  const systemPrompt = `Tu es un redacteur web expert en SEO francais specialise dans les articles invites (guest posts) pour le netlinking. Annee en cours : ${currentYear}.

REGLES CLES :
- Article de QUALITE pour un site EXTERNE — pas promotionnel, vrai contenu de valeur
- Style humain : phrases courtes, varie les longueurs, transitions orales ("Du coup,", "Concretement,")
- Au moins 1 phrase de 4 mots ou moins par section, 2 "vous/votre" par section
- <strong> sur 2-3 termes importants par paragraphe
- Au moins 1 nuance "oui, mais..." dans l'article
- Mot-cle : reformuler naturellement, max 2 occurrences exactes
- INTERDIT : "il convient de", "force est de constater", "dans cet article", "en resume"
- Paragraphes courts (2-3 phrases max), listes avec emojis (✅💡⚠️📊)
- Pas de <h1> dans content_html. Format : <h2>, <p>, <strong>, <ul>/<li>, <a href>
- Chaque H2 commence par une accroche (chiffre, question, constat) — JAMAIS par "Le/La/Les..."
- PAS de conclusion "en resume". La derniere section traite un sujet concret.

FORMAT JSON OBLIGATOIRE — retourne UNIQUEMENT ce JSON, rien d'autre :
{"title":"...","content_html":"<h2>...</h2><p>...</p>","word_count":N,"anchors":[{"type":"exact","text":"...","context_sentence":"..."}]}`

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

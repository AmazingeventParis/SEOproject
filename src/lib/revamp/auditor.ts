// ============================================================
// Revamp Auditor — AI-powered audit of old content
// Decides what to keep, delete, rewrite, and add
// ============================================================

import { routeAI } from '@/lib/ai/router'
import type { ContentBlock } from '@/lib/supabase/types'
import type { RevampAudit, RevampGSCData, RevampSERPComparison } from './types'

/**
 * Run an AI audit on the old article content.
 * Produces a block-by-block keep/delete/rewrite plan + new sections to add.
 */
export async function auditContent(
  keyword: string,
  title: string,
  originalBlocks: ContentBlock[],
  gscData: RevampGSCData,
  serpComparison: RevampSERPComparison,
  preservedLinks: { url: string; anchor: string; isInternal: boolean }[],
  preservedCTAs: string[],
): Promise<RevampAudit> {
  // Build block summary
  const blocksSummary = originalBlocks
    .map((b, i) => {
      const heading = b.heading || '(sans heading)'
      const type = b.type
      const wc = b.word_count
      const content = b.content_html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300)
      const hasLinks = /<a\s/i.test(b.content_html)
      return `BLOC ${i} [${type}] "${heading}" (${wc} mots)${hasLinks ? ' [contient liens]' : ''}\n${content}...`
    })
    .join('\n\n')

  // Internal links summary
  const internalLinksStr = preservedLinks
    .filter(l => l.isInternal)
    .map(l => `- "${l.anchor}" → ${l.url}`)
    .join('\n') || 'Aucun'

  // Missing topics from SERP comparison
  const missingTopicsStr = serpComparison.missingTopics.length > 0
    ? serpComparison.missingTopics.map(t => `- ${t}`).join('\n')
    : 'Aucun sujet manquant identifie'

  // Strengths to keep
  const strengthsStr = serpComparison.strengthsToKeep.length > 0
    ? serpComparison.strengthsToKeep.map(s => `- ${s}`).join('\n')
    : 'Aucun point fort identifie'

  // Opportunity keywords
  const opKws = gscData.opportunityKeywords
    .slice(0, 8)
    .map(k => `"${k.query}" (pos ${k.position.toFixed(0)}, score ${k.opportunityScore})`)
    .join(', ')

  const prompt = `Tu es un expert SEO editorial. Audite cet article existant pour le mot-cle "${keyword}" et cree un plan de mise a jour detaille.

## TITRE ACTUEL
${title}

## BLOCS DE CONTENU
${blocksSummary}

## LIENS INTERNES A PRESERVER
${internalLinksStr}

## CTA EXISTANTS
${preservedCTAs.length > 0 ? preservedCTAs.map(c => c.replace(/<[^>]*>/g, '').trim()).join('\n') : 'Aucun'}

## SUJETS MANQUANTS (vs SERP)
${missingTopicsStr}

## POINTS FORTS A GARDER
${strengthsStr}

## MOTS-CLES OPPORTUNITES GSC
${opKws || 'Aucun'}

## REGLES
1. PRESERVER tous les liens internes (maillage interne = capital SEO)
2. PRESERVER les CTA existants (les deplacer si necessaire)
3. GARDER les sections a forte valeur ajoutee (expertise, exemples concrets, donnees originales)
4. SUPPRIMER les sections obsoletes, redondantes ou trop generiques
5. REECRIRE les sections mal optimisees mais avec un bon sujet
6. AJOUTER de nouvelles sections pour couvrir les sujets manquants
7. Integrer les mots-cles opportunites GSC dans les nouvelles sections
8. Chaque nouvelle section doit avoir des key_ideas MECE (3-5 idees exclusives)

## FORMAT JSON STRICT
{
  "overallScore": 45,
  "blocksToKeep": [{ "blockIndex": 0, "heading": "...", "reason": "..." }],
  "blocksToDelete": [{ "blockIndex": 3, "heading": "...", "reason": "..." }],
  "blocksToRewrite": [{ "blockIndex": 1, "heading": "...", "reason": "...", "directive": "Reecrire en integrant..." }],
  "newSectionsToAdd": [{ "heading": "...", "type": "h2", "insertAfterIndex": 2, "directive": "...", "keyIdeas": ["..."] }],
  "preservedLinks": [{ "url": "...", "anchorText": "...", "isInternal": true }],
  "preservedCTAs": ["texte du CTA..."],
  "suggestedTitle": "Nouveau titre optimise ou null",
  "suggestedMetaDescription": "Nouvelle meta description ou null"
}

overallScore = score de 0 a 100 de l'etat actuel de l'article (100 = excellent, pas besoin de revamp)`

  const response = await routeAI('analyze_serp', [
    { role: 'user', content: prompt },
  ])

  try {
    // Extract JSON from potential markdown code block wrappers
    let jsonStr = response.content.trim()
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    }
    const parsed = JSON.parse(jsonStr)

    return {
      overallScore: Number(parsed.overallScore) || 0,
      blocksToKeep: (parsed.blocksToKeep || []).map((b: Record<string, unknown>) => ({
        blockIndex: Number(b.blockIndex),
        heading: b.heading ? String(b.heading) : null,
        reason: String(b.reason || ''),
      })),
      blocksToDelete: (parsed.blocksToDelete || []).map((b: Record<string, unknown>) => ({
        blockIndex: Number(b.blockIndex),
        heading: b.heading ? String(b.heading) : null,
        reason: String(b.reason || ''),
      })),
      blocksToRewrite: (parsed.blocksToRewrite || []).map((b: Record<string, unknown>) => ({
        blockIndex: Number(b.blockIndex),
        heading: b.heading ? String(b.heading) : null,
        reason: String(b.reason || ''),
        directive: String(b.directive || ''),
      })),
      newSectionsToAdd: (parsed.newSectionsToAdd || []).map((s: Record<string, unknown>) => ({
        heading: String(s.heading || ''),
        type: (s.type === 'h3' ? 'h3' : 'h2') as 'h2' | 'h3',
        insertAfterIndex: Number(s.insertAfterIndex ?? -1),
        directive: String(s.directive || ''),
        keyIdeas: (s.keyIdeas as string[]) || [],
      })),
      preservedLinks: (parsed.preservedLinks || preservedLinks).map((l: Record<string, unknown>) => ({
        url: String(l.url || ''),
        anchorText: String(l.anchorText || l.anchor || ''),
        isInternal: Boolean(l.isInternal),
      })),
      preservedCTAs: (parsed.preservedCTAs || []) as string[],
      suggestedTitle: parsed.suggestedTitle ? String(parsed.suggestedTitle) : null,
      suggestedMetaDescription: parsed.suggestedMetaDescription ? String(parsed.suggestedMetaDescription) : null,
    }
  } catch (err) {
    console.error('[revamp-auditor] JSON parse error:', err)
    console.error('[revamp-auditor] Raw response (first 500 chars):', response.content.slice(0, 500))
    throw new Error('Echec du parsing de l\'audit IA. Reponse invalide.')
  }
}

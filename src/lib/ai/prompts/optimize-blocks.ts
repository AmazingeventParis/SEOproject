// ============================================================
// Auto-Optimization Prompt
// Rewrites specific content blocks to fix issues detected by
// the AI critique (sub-step E of executeSeo).
// Only rewrites blocks with identified problems.
// ============================================================

import {
  SEO_EEAT_RULES,
  SEO_ANTI_AI_PATTERNS,
  SEO_KEYWORD_RULES,
  SEO_WRITING_STYLE_RULES,
  INTENT_STRATEGIES,
} from './seo-guidelines'

interface BlockForOptimization {
  index: number
  type: string
  heading: string | null
  content_html: string
  word_count: number
}

interface OptimizeBlocksParams {
  keyword: string
  searchIntent?: string
  articleTitle: string
  persona: {
    name: string
    role: string
    tone_description: string | null
    bio: string | null
  }
  blocks: BlockForOptimization[]
  issues: string[]
  suggestions: string[]
  scores: {
    score: number
    eeat_score: number
    readability: number
    seo_score: number
  }
}

interface OptimizeBlocksPrompt {
  system: string
  user: string
}

/**
 * Build the system and user prompts for auto-optimization of content blocks.
 *
 * The AI should return ONLY valid JSON:
 * {
 *   "optimized_blocks": [
 *     {
 *       "block_index": 2,
 *       "reason": "mot-cle absent + manque ancrage persona",
 *       "new_content_html": "<p>...</p>"
 *     }
 *   ]
 * }
 */
export function buildOptimizeBlocksPrompt(params: OptimizeBlocksParams): OptimizeBlocksPrompt {
  const { keyword, searchIntent, articleTitle, persona, blocks, issues, suggestions, scores } = params

  const intentWriting = searchIntent && INTENT_STRATEGIES[searchIntent]?.writing
    ? `\n\nStrategie d'ecriture pour l'intention "${searchIntent}" :\n${INTENT_STRATEGIES[searchIntent].writing}`
    : ''

  const system = `Tu es un expert en optimisation de contenu SEO. Tu recois un article avec ses scores d'audit et les problemes detectes. Tu dois REECRIRE UNIQUEMENT les blocs concernes pour corriger les problemes identifies.

## TON ROLE
Corriger les blocs de contenu qui ont des problemes identifies par l'audit, sans toucher aux blocs sans probleme.

## REGLES STRICTES

### Ce que tu DOIS faire :
- Ne reecrire QUE les blocs directement concernes par les issues/suggestions
- Conserver TOUS les liens internes existants (<a href="...">) — ne jamais les supprimer
- Respecter le word_count minimum du bloc original (tolerance +/- 15%)
- Garder le style et le ton du persona "${persona.name}" (${persona.role})
- Garder la structure HTML existante (listes, tableaux, callouts, etc.)
- Ameliorer la densite semantique et le placement naturel du mot-cle

### Ce que tu ne dois PAS faire :
- Ne PAS toucher les blocs sans probleme
- Ne PAS ajouter de nouveaux liens
- Ne PAS changer les headings (titres H2/H3/H4) — ils sont geres separement
- Ne PAS reecrire un bloc entier si seule une phrase pose probleme
- Ne PAS depasser 8 blocs optimises (concentre-toi sur les plus impactants)

## REGLES SEO

### E-E-A-T
${SEO_EEAT_RULES}

### Style d'ecriture
${SEO_WRITING_STYLE_RULES}

### Mots-cles
${SEO_KEYWORD_RULES}

### Formulations interdites
${SEO_ANTI_AI_PATTERNS}
${intentWriting}

## FORMAT DE SORTIE
Retourne UNIQUEMENT un objet JSON valide :
{
  "optimized_blocks": [
    {
      "block_index": <number>,
      "reason": "<explication courte de la correction>",
      "new_content_html": "<contenu HTML corrige>"
    }
  ]
}

Si aucun bloc n'a besoin d'etre corrige, retourne : { "optimized_blocks": [] }`

  // Build blocks representation for the user prompt
  const blocksText = blocks
    .map((b) => {
      const heading = b.heading ? ` | heading: "${b.heading}"` : ''
      return `[Bloc ${b.index}] type: ${b.type}${heading} | ${b.word_count} mots\n${b.content_html}`
    })
    .join('\n\n---\n\n')

  const user = `## ARTICLE A OPTIMISER

### Mot-cle principal : "${keyword}"
### Titre : "${articleTitle}"${searchIntent ? `\n### Intention de recherche : ${searchIntent}` : ''}

### Persona / Auteur
- Nom : ${persona.name}
- Role : ${persona.role}${persona.tone_description ? `\n- Ton : ${persona.tone_description}` : ''}${persona.bio ? `\n- Bio : ${persona.bio}` : ''}

### Scores actuels
- Score global : ${scores.score}/100
- E-E-A-T : ${scores.eeat_score}/100
- Lisibilite : ${scores.readability}/100
- SEO : ${scores.seo_score}/100

### PROBLEMES DETECTES (a corriger)
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

### SUGGESTIONS D'AMELIORATION
${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### BLOCS DE CONTENU (avec index)
${blocksText}

## INSTRUCTIONS
1. Analyse les problemes et suggestions ci-dessus
2. Identifie les blocs concernes par chaque probleme
3. Reecris UNIQUEMENT ces blocs pour corriger les problemes
4. Conserve les liens internes, la structure HTML et le style du persona
5. Vise un score >= 90/100 apres correction

Retourne UNIQUEMENT le JSON avec les blocs optimises.`

  return { system, user }
}

// ============================================================
// Competitor Content Scraper & Semantic Analyzer
// Scrapes top SERP pages via Jina Reader, extracts TF-IDF keywords,
// analyzes heading structure, and generates semantic analysis via Gemini
// ============================================================

// ---- Types ----

export interface CompetitorPage {
  url: string
  domain: string
  title: string
  scrapeSuccess: boolean
  markdown: string | null
  wordCount: number
  headings: HeadingNode[]
}

export interface HeadingNode {
  level: number // 1-6
  text: string
  children: HeadingNode[]
}

export interface TermScore {
  term: string
  tfidf: number
  df: number // number of documents containing the term
}

export interface CompetitorContentAnalysis {
  pages: CompetitorPage[]
  avgWordCount: number
  commonHeadings: string[]
  tfidfKeywords: TermScore[]
  scrapedCount: number
  totalCount: number
}

// ---- Jina Reader scraping ----

/**
 * Scrape a URL via Jina Reader (r.jina.ai) and return markdown content.
 * Free, no API key required.
 */
export async function scrapeWithJina(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/markdown',
      },
    })

    if (!response.ok) {
      throw new Error(`Jina scrape failed: ${response.status} ${response.statusText}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

// ---- Heading structure extraction ----

/**
 * Parse markdown headings into a tree of HeadingNode.
 */
export function extractHeadingStructure(markdown: string): HeadingNode[] {
  const lines = markdown.split('\n')
  const headings: { level: number; text: string }[] = []

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/[#*_`\[\]]/g, '').trim(),
      })
    }
  }

  // Build tree structure
  const root: HeadingNode[] = []
  const stack: HeadingNode[] = []

  for (const h of headings) {
    const node: HeadingNode = { level: h.level, text: h.text, children: [] }

    // Find parent: go up the stack until we find a heading with a lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }

    stack.push(node)
  }

  return root
}

// ---- Word counting ----

/**
 * Count words from markdown, stripping syntax.
 */
export function countWordsFromMarkdown(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, '') // remove code blocks
    .replace(/`[^`]*`/g, '')        // remove inline code
    .replace(/!\[.*?\]\(.*?\)/g, '') // remove images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // keep link text
    .replace(/#{1,6}\s+/g, '')      // remove heading markers
    .replace(/[*_~`>|]/g, '')       // remove formatting chars
    .replace(/[-=]{3,}/g, '')       // remove horizontal rules
    .replace(/\s+/g, ' ')
    .trim()

  return text ? text.split(' ').filter(w => w.length > 0).length : 0
}

// ---- Tokenization & stop words ----

const STOP_WORDS_FR = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux', 'ce', 'ces',
  'cette', 'et', 'ou', 'en', 'dans', 'pour', 'par', 'sur', 'avec', 'sans',
  'est', 'sont', 'a', 'ont', 'etre', 'avoir', 'faire', 'dire', 'plus', 'pas',
  'ne', 'se', 'que', 'qui', 'quoi', 'dont', 'il', 'elle', 'ils', 'elles',
  'nous', 'vous', 'je', 'tu', 'on', 'son', 'sa', 'ses', 'leur', 'leurs',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'votre', 'tout', 'tous',
  'toute', 'toutes', 'autre', 'autres', 'meme', 'aussi', 'bien', 'tres',
  'peut', 'fait', 'comme', 'mais', 'donc', 'car', 'si', 'ni', 'entre',
  'ici', 'encore', 'ainsi', 'alors', 'depuis', 'avant', 'apres', 'peu',
  'sous', 'chez', 'vers', 'lors', 'chaque', 'quelque', 'plusieurs',
])

const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'not', 'no',
  'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'they',
  'we', 'you', 'i', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'our', 'their', 'what', 'which', 'who', 'whom', 'where', 'when',
  'how', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about', 'above',
  'after', 'again', 'also', 'any', 'because', 'before', 'between', 'down',
  'during', 'here', 'into', 'only', 'out', 'over', 'same', 'so', 'then',
  'there', 'through', 'under', 'up', 'while', 'get', 'got', 'one', 'two',
])

const ALL_STOP_WORDS = new Set(Array.from(STOP_WORDS_FR).concat(Array.from(STOP_WORDS_EN)))

/**
 * Tokenize text: lowercase, remove punctuation, filter stop words, keep words >= 3 chars.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, ' ')  // keep letters (incl accented), numbers, hyphens
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(word => word.length >= 3 && !ALL_STOP_WORDS.has(word))
}

// ---- TF-IDF computation ----

/**
 * Compute TF-IDF across multiple documents. Returns top N terms sorted by score.
 */
export function computeTFIDF(documents: string[], topN: number = 50): TermScore[] {
  if (documents.length === 0) return []

  const N = documents.length
  const docTokens = documents.map(doc => tokenize(doc))

  // Document frequency: how many docs contain each term
  const df: Record<string, number> = {}
  for (const tokens of docTokens) {
    const uniqueTerms = Array.from(new Set(tokens))
    for (const term of uniqueTerms) {
      df[term] = (df[term] || 0) + 1
    }
  }

  // For each term, compute average TF-IDF across all documents
  const tfidfScores: Record<string, number> = {}

  for (const tokens of docTokens) {
    // Term frequency in this document
    const tf: Record<string, number> = {}
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1
    }

    const totalTokens = tokens.length
    if (totalTokens === 0) continue

    for (const [term, count] of Object.entries(tf)) {
      const termFreq = count / totalTokens
      const idf = Math.log(1 + N / (df[term] || 1))
      const score = termFreq * idf
      tfidfScores[term] = (tfidfScores[term] || 0) + score / N
    }
  }

  // Sort and return top N
  return Object.entries(tfidfScores)
    .map(([term, tfidf]) => ({ term, tfidf, df: df[term] || 0 }))
    .sort((a, b) => b.tfidf - a.tfidf)
    .slice(0, topN)
}

// ---- Gemini analysis prompt ----

export function buildCompetitorAnalysisPrompt(
  keyword: string,
  analysis: CompetitorContentAnalysis
): string {
  const headingsList = analysis.commonHeadings.slice(0, 20).join('\n- ')
  const tfidfList = analysis.tfidfKeywords
    .slice(0, 30)
    .map(t => `${t.term} (score: ${t.tfidf.toFixed(4)}, present dans ${t.df}/${analysis.scrapedCount} pages)`)
    .join('\n- ')

  const pagesInfo = analysis.pages
    .filter(p => p.scrapeSuccess)
    .map(p => {
      const h2s = flattenHeadings(p.headings, 2).join(', ')
      return `- ${p.domain}: ${p.wordCount} mots | H2: ${h2s || 'aucun'}`
    })
    .join('\n')

  return `Tu es un expert SEO. Analyse le contenu des concurrents pour le mot-cle "${keyword}".

## DONNEES D'ANALYSE

### Pages concurrentes scrapees (${analysis.scrapedCount}/${analysis.totalCount})
${pagesInfo}

### Nombre de mots moyen: ${analysis.avgWordCount}

### Titres H2 les plus courants:
- ${headingsList || 'Aucun titre commun identifie'}

### Termes TF-IDF les plus importants:
- ${tfidfList || 'Aucun terme extrait'}

## INSTRUCTIONS
Retourne un JSON valide (sans bloc markdown) avec cette structure exacte:
{
  "contentGaps": [
    { "label": "Titre court de la lacune", "type": "calculator|comparison|checklist|specific_question|interactive|data|text", "description": "Description detaillee de ce que cet element apporterait a l'article" }
  ],
  "semanticField": ["terme1", "terme2", ...],
  "recommendedWordCount": nombre,
  "recommendedH2Structure": ["H2 titre 1", "H2 titre 2", ...],
  "keyDifferentiators": ["angle 1", "angle 2", ...],
  "mustAnswerQuestions": ["question 1", "question 2", ...]
}

Regles:
- contentGaps: 5-8 opportunites de contenu DIVERSIFIEES. Ne propose pas que du texte brut ! Pense a des FORMATS DIFFERENTS qui apportent une vraie valeur ajoutee :
  - **calculator** : simulateur, calculateur interactif, estimateur (ex: "Calculez votre budget mensuel", "Simulateur de rentabilite")
  - **comparison** : tableau comparatif detaille, versus, benchmark (ex: "Comparatif prix/fonctionnalites des 5 leaders")
  - **checklist** : liste actionnable, guide etape par etape, to-do (ex: "Checklist des 12 points a verifier avant de signer")
  - **specific_question** : reponse a une question tres precise que les concurrents survolent (ex: "Que faire si X arrive dans la situation Y ?")
  - **interactive** : quiz, decision tree, auto-diagnostic (ex: "Quel type de X correspond a votre profil ?")
  - **data** : infographie, statistiques cles, chiffres exclusifs, etude de cas chiffree (ex: "Les 10 chiffres cles du marche en ${new Date().getFullYear()}")
  - **text** : angle editorial, temoignage, expertise approfondie (ex: "Retour d'experience : 3 erreurs courantes de debutants")

  IMPORTANT : au moins 3 gaps doivent etre de type NON-text (calculator, comparison, checklist, interactive, data). L'objectif est de DIFFERENCIER l'article des concurrents par des formats originaux, pas juste ajouter plus de texte.

- semanticField: 15-25 termes du champ semantique a integrer dans l'article
- recommendedWordCount: nombre de mots recommande (basé sur la moyenne + 20%)
- recommendedH2Structure: 4-8 H2 recommandés couvrant tout le sujet
- keyDifferentiators: 2-4 angles originaux pour se différencier
- mustAnswerQuestions: 3-6 questions auxquelles l'article doit absolument répondre

Retourne UNIQUEMENT le JSON.`
}

// ---- Main orchestration ----

/**
 * Scrape top SERP organic results, compute TF-IDF keywords, extract heading structures.
 * Filters out the user's own domain if provided.
 *
 * @param serpOrganic  Array of SERP organic results with link and domain
 * @param ownDomain   Optional domain to exclude (user's own site)
 */
export async function analyzeCompetitorContent(
  serpOrganic: { link: string; domain: string; title: string }[],
  ownDomain?: string
): Promise<CompetitorContentAnalysis> {
  // Filter out own domain and take top 5
  const targets = serpOrganic
    .filter(r => !ownDomain || !r.domain.includes(ownDomain))
    .slice(0, 5)

  const pages: CompetitorPage[] = []

  for (const target of targets) {
    try {
      const markdown = await scrapeWithJina(target.link)
      const headings = extractHeadingStructure(markdown)
      const wordCount = countWordsFromMarkdown(markdown)

      pages.push({
        url: target.link,
        domain: target.domain,
        title: target.title,
        scrapeSuccess: true,
        markdown,
        wordCount,
        headings,
      })
    } catch {
      pages.push({
        url: target.link,
        domain: target.domain,
        title: target.title,
        scrapeSuccess: false,
        markdown: null,
        wordCount: 0,
        headings: [],
      })
    }

    // 1s delay between requests to be polite
    if (targets.indexOf(target) < targets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const successPages = pages.filter(p => p.scrapeSuccess && p.markdown)
  const scrapedCount = successPages.length

  if (scrapedCount === 0) {
    return {
      pages,
      avgWordCount: 0,
      commonHeadings: [],
      tfidfKeywords: [],
      scrapedCount: 0,
      totalCount: targets.length,
    }
  }

  // Compute TF-IDF across all scraped pages
  const documents = successPages.map(p => p.markdown!)
  const tfidfKeywords = computeTFIDF(documents)

  // Extract common H2 headings (appearing in >= 2 pages)
  const h2Counts: Record<string, number> = {}
  for (const page of successPages) {
    const h2s = flattenHeadings(page.headings, 2)
    const seen = new Set<string>()
    for (const h2 of h2s) {
      const normalized = h2.toLowerCase().trim()
      if (!seen.has(normalized)) {
        h2Counts[normalized] = (h2Counts[normalized] || 0) + 1
        seen.add(normalized)
      }
    }
  }

  const commonHeadings = Object.entries(h2Counts)
    .filter(([, count]) => count >= 2 || scrapedCount <= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([heading]) => heading)

  // Average word count
  const avgWordCount = Math.round(
    successPages.reduce((sum, p) => sum + p.wordCount, 0) / scrapedCount
  )

  return {
    pages,
    avgWordCount,
    commonHeadings,
    tfidfKeywords,
    scrapedCount,
    totalCount: targets.length,
  }
}

// ---- Helpers ----

/**
 * Flatten heading tree to get all headings at a specific level.
 */
function flattenHeadings(nodes: HeadingNode[], level: number): string[] {
  const result: string[] = []
  for (const node of nodes) {
    if (node.level === level) {
      result.push(node.text)
    }
    if (node.children.length > 0) {
      result.push(...flattenHeadings(node.children, level))
    }
  }
  return result
}

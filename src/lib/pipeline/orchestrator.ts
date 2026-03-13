import { getServerClient } from '@/lib/supabase/client'
import type { Article, ArticleStatus, ContentBlock, AuthorityLinkSuggestion, SelectedAuthorityLink } from '@/lib/supabase/types'
import type { PipelineStep, PipelineContext, PipelineRunResult } from './types'

// Article with joined relations from Supabase query
type ArticleWithRelations = Article & {
  seo_personas: { name: string; role: string; tone_description: string | null; bio: string | null; avatar_reference_url: string | null; writing_style_examples: Record<string, unknown>[] } | null
  seo_sites: { name: string; domain: string; niche: string | null; theme_color: string | null; money_page_url: string | null; money_page_description: string | null } | null
}
import { validateTransition, getNextStatus } from './state-machine'
import { analyzeSERP, extractCompetitorInsights } from '@/lib/seo/serper'
import { checkCannibalization } from '@/lib/seo/anti-cannibal'
import { analyzeCompetitorContent, buildCompetitorAnalysisPrompt } from '@/lib/seo/competitor-scraper'
import type { CompetitorContentAnalysis } from '@/lib/seo/competitor-scraper'
import { routeAI, routeAIWithOverrides, modelIdToOverride } from '@/lib/ai/router'
import type { ModelConfig } from '@/lib/ai/types'
import { buildPlanArchitectPrompt } from '@/lib/ai/prompts/plan-architect'
import { buildBlockWriterPrompt } from '@/lib/ai/prompts/block-writer'
import { generateImage, buildImagePrompt, generateHeroImage } from '@/lib/media/fal-ai'
import { optimizeForWeb } from '@/lib/media/sharp-processor'
import { generateSeoFilename, generateAltText, generateImageTitle } from '@/lib/media/seo-rename'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema, generateHowToSchema, generateReviewSchema, assembleJsonLd } from '@/lib/seo/json-ld'
import { generateInternalLinks, injectLinksIntoHtml } from '@/lib/seo/internal-links'
import { createPost, updatePost, uploadMedia, findBestCategory, findOrCreateTags, getAllPublishedPosts } from '@/lib/wordpress/client'
import { analyzeKeywordDensity } from '@/lib/seo/keyword-analysis'
import { buildCritiquePrompt, validateCritiqueResult } from '@/lib/ai/prompts/critique'
import { buildOptimizeBlocksPrompt } from '@/lib/ai/prompts/optimize-blocks'

/**
 * Extract and parse JSON from AI response text.
 * Handles: markdown fences, text before/after JSON, nested braces, trailing commas.
 */
function extractJSON<T = unknown>(raw: string): T {
  // 1. Try stripping markdown fences first
  let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // continue to fallback strategies
  }

  // 2. Extract the first top-level { ... } block (handles text before/after)
  const firstBrace = cleaned.indexOf('{')
  if (firstBrace !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    let endIndex = -1
    const stack: string[] = [] // track [ and { for truncation repair

    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"' && !escape) { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') { depth++; stack.push('{') }
      if (ch === '[') stack.push('[')
      if (ch === ']' && stack.length > 0 && stack[stack.length - 1] === '[') stack.pop()
      if (ch === '}') {
        depth--
        if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop()
        if (depth === 0) { endIndex = i; break }
      }
    }

    if (endIndex !== -1) {
      cleaned = cleaned.substring(firstBrace, endIndex + 1)
    } else {
      // JSON is truncated — close open strings, arrays, objects
      cleaned = cleaned.substring(firstBrace)
      if (inString) cleaned += '"'
      // Close any trailing partial key-value (remove dangling comma or incomplete value)
      cleaned = cleaned.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '')
      cleaned = cleaned.replace(/,\s*$/, '')
      // Close remaining open brackets/braces in reverse order
      for (let i = stack.length - 1; i >= 0; i--) {
        cleaned += stack[i] === '[' ? ']' : '}'
      }
    }

    // Fix trailing commas before } or ]
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(cleaned) as T
    } catch {
      // continue
    }
  }

  throw new Error(`JSON invalide. Debut de la reponse IA : ${raw.substring(0, 300)}`)
}

/**
 * Resolve default model override from seo_config for a given step.
 * Returns undefined if no default is configured.
 */
async function resolveDefaultModel(step: PipelineStep): Promise<Partial<ModelConfig> | undefined> {
  const configKey = step === 'plan' ? 'default_model_plan' : step === 'write_block' ? 'default_model_write' : null
  if (!configKey) return undefined

  try {
    const supabase = getServerClient()
    const { data } = await supabase
      .from('seo_config')
      .select('value')
      .eq('key', configKey)
      .single()

    if (data?.value && typeof data.value === 'string') {
      return modelIdToOverride(data.value)
    }
  } catch {
    // fall through to hardcoded defaults
  }
  return undefined
}

/**
 * Execute a pipeline step for an article
 */
export async function executeStep(
  articleId: string,
  step: PipelineStep,
  input?: Record<string, unknown>
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const startTime = Date.now()

  // Fetch article with persona and site
  const { data: article, error: fetchError } = await supabase
    .from('seo_articles')
    .select('*, seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio, avatar_reference_url, writing_style_examples), seo_sites!seo_articles_site_id_fkey(name, domain, niche, theme_color, money_page_url, money_page_description)')
    .eq('id', articleId)
    .single()

  if (fetchError || !article) {
    return { success: false, runId: '', error: `Article non trouve: ${fetchError?.message}` }
  }

  // Build context
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const context: PipelineContext = {
    articleId,
    siteId: article.site_id,
    keyword: article.keyword,
    personaId: article.persona_id,
    siloId: article.silo_id,
    nuggetDensityScore: article.nugget_density_score,
    contentBlocksCount: contentBlocks.length,
    writtenBlocksCount: contentBlocks.filter((b: ContentBlock) => b.status === 'written' || b.status === 'approved').length,
    titleSelected: !!article.title,
  }

  // Validate transition
  const validation = validateTransition(article.status as ArticleStatus, step, context)
  if (validation !== true) {
    return { success: false, runId: '', error: validation }
  }

  // Create pipeline run record
  const { data: run, error: runError } = await supabase
    .from('seo_pipeline_runs')
    .insert({ article_id: articleId, step, status: 'running', input: input || {} })
    .select()
    .single()

  if (runError || !run) {
    return { success: false, runId: '', error: `Impossible de creer le run: ${runError?.message}` }
  }

  // Extract modelOverride from input, or resolve default from seo_config
  const modelOverride = (input?.modelOverride as Partial<ModelConfig> | undefined)
    || await resolveDefaultModel(step)

  try {
    let result: PipelineRunResult

    switch (step) {
      case 'analyze':
        result = await executeAnalyze(article as ArticleWithRelations)
        break
      case 'plan':
        result = await executePlan(article as ArticleWithRelations, modelOverride)
        break
      case 'write_block':
        result = await executeWriteBlock(article as ArticleWithRelations, input, modelOverride)
        break
      case 'media':
        result = await executeMedia(article as ArticleWithRelations)
        break
      case 'seo':
        result = await executeSeo(article as ArticleWithRelations)
        break
      case 'publish':
        result = await executePublish(article as ArticleWithRelations)
        break
      case 'refresh':
        result = await executeRefresh(article as ArticleWithRelations, input)
        break
      default:
        result = { success: false, runId: run.id, error: `Step "${step}" non implemente` }
    }

    // Update pipeline run
    const duration = Date.now() - startTime
    await supabase
      .from('seo_pipeline_runs')
      .update({
        status: result.success ? 'success' : 'error',
        output: result.output || {},
        model_used: result.modelUsed || null,
        tokens_in: result.tokensIn || 0,
        tokens_out: result.tokensOut || 0,
        cost_usd: result.costUsd || 0,
        duration_ms: duration,
        error: result.error || null,
      })
      .eq('id', run.id)

    // Update article status if transition succeeds
    if (result.success) {
      const nextStatus = getNextStatus(article.status as ArticleStatus, step)
      if (nextStatus && nextStatus !== article.status) {
        await supabase
          .from('seo_articles')
          .update({ status: nextStatus })
          .eq('id', articleId)
      }
    }

    return { ...result, runId: run.id, durationMs: duration }
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    if (errorStack) {
      console.error(`[orchestrator] ${step} error stack:`, errorStack)
    }

    await supabase
      .from('seo_pipeline_runs')
      .update({ status: 'error', error: errorStack ? `${errorMessage}\n${errorStack}` : errorMessage, duration_ms: duration })
      .eq('id', run.id)

    return { success: false, runId: run.id, error: errorMessage, durationMs: duration }
  }
}

// ---- Step implementations ----

async function executeAnalyze(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // 1. SERP analysis (with 24h cache)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serpData: any = null
  let competitorInsights = null
  const existingSerpForCache = (article.serp_data || {}) as Record<string, unknown>
  const cachedAnalyzedAt = existingSerpForCache.analyzedAt as string | undefined
  const cacheAge = cachedAnalyzedAt ? Date.now() - new Date(cachedAnalyzedAt).getTime() : Infinity
  const SERP_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h

  if (cacheAge < SERP_CACHE_TTL && existingSerpForCache.serp) {
    // Reuse cached SERP data
    serpData = existingSerpForCache.serp
    competitorInsights = existingSerpForCache.insights || extractCompetitorInsights(serpData)
    console.log(`[analyze] Reusing cached SERP data (age: ${Math.round(cacheAge / 3600000)}h)`)
  } else {
    try {
      serpData = await analyzeSERP(article.keyword)
      competitorInsights = extractCompetitorInsights(serpData)
    } catch (error) {
      // SERP analysis is optional - continue if API key not set
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('non configur') && !msg.includes('not found')) throw error
    }
  }

  // 2. Competitor content scraping + TF-IDF + Gemini semantic analysis
  let competitorContent: CompetitorContentAnalysis | null = null
  let semanticAnalysis: Record<string, unknown> | null = null
  let competitorCostUsd = 0
  let competitorTokensIn = 0
  let competitorTokensOut = 0
  let competitorModel: string | undefined

  try {
    if (serpData?.organic && serpData.organic.length > 0) {
      const siteDomain = (article as ArticleWithRelations).seo_sites?.domain
      competitorContent = await analyzeCompetitorContent(
        serpData.organic.map((r: { title: string; link: string; domain: string }) => ({
          link: r.link,
          domain: r.domain,
          title: r.title,
        })),
        siteDomain || undefined
      )

      // Run Gemini semantic analysis if we got scraped content
      if (competitorContent.scrapedCount > 0) {
        try {
          const prompt = buildCompetitorAnalysisPrompt(article.keyword, competitorContent)
          const aiResponse = await routeAI(
            'analyze_competitor_content',
            [{ role: 'user', content: prompt }]
          )
          competitorTokensIn = aiResponse.tokensIn
          competitorTokensOut = aiResponse.tokensOut
          competitorModel = aiResponse.model
          competitorCostUsd = estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model)

          semanticAnalysis = extractJSON(aiResponse.content)
        } catch {
          // Gemini analysis failed — continue without it
        }
      }
    }
  } catch {
    // Competitor scraping failed entirely — continue without it
  }

  // 3. Cannibalization check
  const cannibalization = await checkCannibalization(article.keyword, article.site_id, article.id)

  // 4. Build serp_data payload with optional competitor data
  const serpDataPayload: Record<string, unknown> = {}
  if (serpData) {
    serpDataPayload.serp = serpData
    serpDataPayload.insights = competitorInsights
    serpDataPayload.analyzedAt = new Date().toISOString()
  }
  if (competitorContent) {
    serpDataPayload.competitorContent = {
      avgWordCount: competitorContent.avgWordCount,
      commonHeadings: competitorContent.commonHeadings,
      tfidfKeywords: competitorContent.tfidfKeywords,
      scrapedCount: competitorContent.scrapedCount,
      totalCount: competitorContent.totalCount,
    }
  }
  if (semanticAnalysis) {
    serpDataPayload.semanticAnalysis = semanticAnalysis
  }

  // 5. Update article with SERP data
  await supabase
    .from('seo_articles')
    .update({
      serp_data: Object.keys(serpDataPayload).length > 0 ? serpDataPayload : null,
      status: 'analyzing' as ArticleStatus,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      serpData: serpData ? { organic: serpData.organic.length, paa: serpData.peopleAlsoAsk.length } : null,
      cannibalization: {
        hasConflict: cannibalization.hasConflict,
        conflictCount: cannibalization.conflicts.length,
        recommendation: cannibalization.recommendation,
      },
      competitorInsights,
      competitorContent: competitorContent ? {
        scrapedCount: competitorContent.scrapedCount,
        totalCount: competitorContent.totalCount,
        avgWordCount: competitorContent.avgWordCount,
        tfidfKeywordsCount: competitorContent.tfidfKeywords.length,
      } : null,
      semanticAnalysis: semanticAnalysis ? 'generated' : null,
    },
    tokensIn: competitorTokensIn,
    tokensOut: competitorTokensOut,
    costUsd: competitorCostUsd,
    modelUsed: competitorModel,
  }
}

async function executePlan(
  article: ArticleWithRelations,
  modelOverride?: Partial<ModelConfig>,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // Fetch nuggets for this site, ranked by keyword relevance
  const { data: rawNuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags, source_type')
    .or(`site_id.eq.${article.site_id},site_id.is.null`)
    .limit(50)

  // Score nuggets by keyword relevance and take top 20
  const kwWords = article.keyword.toLowerCase().split(/\s+/)
  const nuggets = (rawNuggets || [])
    .map(n => {
      const content = (n.content || '').toLowerCase()
      const tags = (n.tags || []).map((t: string) => t.toLowerCase())
      const tagScore = kwWords.filter(w => tags.some((t: string) => t.includes(w))).length * 3
      const contentScore = kwWords.filter(w => content.includes(w)).length
      return { ...n, _relevance: tagScore + contentScore }
    })
    .sort((a, b) => b._relevance - a._relevance)
    .slice(0, 20)

  // Fetch ALL published/written articles from the same site for internal linking
  const { data: siteArticlesData } = await supabase
    .from('seo_articles')
    .select('keyword, title, slug')
    .eq('site_id', article.site_id)
    .neq('id', article.id)
    .not('slug', 'is', null)
    .not('title', 'is', null)
    .limit(100)
  const dbArticles = (siteArticlesData || []) as { keyword: string; title: string | null; slug: string | null }[]

  // Also fetch WordPress sitemap (all published posts) for comprehensive internal linking
  let wpPosts: { id: number; title: string; slug: string; link: string }[] = []
  try {
    wpPosts = await getAllPublishedPosts(article.site_id)
  } catch {
    // WordPress not reachable — continue with DB articles only
  }

  // Merge DB articles + WP sitemap, deduplicate by slug
  const slugSet = new Set(dbArticles.map(a => a.slug))
  const wpOnlyPosts = wpPosts
    .filter(p => !slugSet.has(p.slug))
    .filter(p => p.slug !== article.slug && p.id !== article.wp_post_id)
    .map(p => ({ keyword: p.title, title: p.title, slug: p.slug }))
  const siteArticles = [...dbArticles, ...wpOnlyPosts]

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null; avatar_reference_url: string | null; writing_style_examples: Record<string, unknown>[] } | null
  const serpDataRaw = article.serp_data as {
    serp?: { organic: { title: string; snippet: string }[]; peopleAlsoAsk: { question: string }[] }
    competitorContent?: { avgWordCount: number; commonHeadings: string[]; tfidfKeywords: { term: string; tfidf: number; df: number }[] }
    semanticAnalysis?: { contentGaps: (string | { label: string; type: string; description: string })[]; semanticField: string[]; recommendedWordCount: number; recommendedH2Structure: string[]; keyDifferentiators: string[]; mustAnswerQuestions: string[] }
  } | null

  // Build money page config if applicable
  const site = article.seo_sites
  const moneyPage = article.link_to_money_page && site?.money_page_url
    ? { url: site.money_page_url, description: site.money_page_description || '' }
    : null

  // Build prompt and call AI
  const prompt = buildPlanArchitectPrompt({
    keyword: article.keyword,
    searchIntent: article.search_intent,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null, avatar_reference_url: null, writing_style_examples: [] },
    serpData: serpDataRaw?.serp as Parameters<typeof buildPlanArchitectPrompt>[0]['serpData'],
    nuggets: (nuggets || []).map((n: { id: string; content: string; tags: string[]; source_type?: string }) => ({ id: n.id, content: n.content, tags: n.tags, source_type: n.source_type })),
    existingSiloArticles: siteArticles,
    moneyPage,
    competitorContent: serpDataRaw?.competitorContent,
    semanticAnalysis: serpDataRaw?.semanticAnalysis,
    selectedContentGaps: (serpDataRaw as Record<string, unknown> | null)?.selectedContentGaps as string[] | undefined,
  })

  const aiResponse = modelOverride
    ? await routeAIWithOverrides('plan_article', [{ role: 'user', content: prompt.user }], prompt.system, modelOverride)
    : await routeAI('plan_article', [{ role: 'user', content: prompt.user }], prompt.system)

  // Parse the AI response as JSON plan
  let plan: { title_suggestions: { title: string; seo_title?: string; slug: string; seo_rationale: string }[]; meta_description: string; content_blocks: ContentBlock[] }
  try {
    plan = extractJSON(aiResponse.content)
  } catch (parseError) {
    const msg = parseError instanceof Error ? parseError.message : String(parseError)
    const contentLen = aiResponse.content?.length || 0
    const tail = aiResponse.content?.slice(-200) || ''
    console.error('[Plan Parse Error]', msg, `| len=${contentLen} tokensOut=${aiResponse.tokensOut} tail=${tail}`)
    return {
      success: false,
      runId: '',
      error: `Impossible de parser le plan genere par l'IA : ${msg} [len=${contentLen}, tokensOut=${aiResponse.tokensOut}, fin: ...${tail.slice(-100)}]`,
      tokensIn: aiResponse.tokensIn,
      tokensOut: aiResponse.tokensOut,
      modelUsed: aiResponse.model,
    }
  }

  // Ensure content_blocks and title_suggestions are arrays
  if (!Array.isArray(plan.content_blocks)) plan.content_blocks = []
  if (!Array.isArray(plan.title_suggestions)) plan.title_suggestions = []

  // Ensure intro block exists as first element (type paragraph, heading null, before first H2)
  const blocks = plan.content_blocks
  const firstBlock = blocks[0]
  const hasIntro = firstBlock && firstBlock.type === 'paragraph' && !firstBlock.heading
  if (!hasIntro) {
    const introBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: 'paragraph',
      heading: undefined,
      content_html: '',
      nugget_ids: [],
      word_count: 120,
      status: 'pending',
      writing_directive: `Intro courte (100-140 mots). Contient le mot-cle "${article.keyword}". Valide que le lecteur est au bon endroit (identifie la cible). Inclus une phrase explicite sur ce que le lecteur va apprendre. Phrases courtes, percutantes, zero fluff. 1-2 <p> uniquement.`,
      format_hint: 'prose',
    }
    plan.content_blocks = [introBlock, ...blocks]
  }

  // Enforce minimum word counts — AI sometimes generates very low values (30-50)
  for (const block of plan.content_blocks) {
    if (block.type === 'paragraph' && !block.heading) {
      // Intro block: min 100
      if (block.word_count < 100) block.word_count = 120
    } else if (block.type === 'h2') {
      // H2 blocks: min 250
      if (block.word_count < 250) block.word_count = 300
    } else if (block.type === 'h3') {
      // H3 blocks: min 150
      if (block.word_count < 150) block.word_count = 200
    } else if (block.type === 'faq') {
      // FAQ: min 300
      if (block.word_count < 300) block.word_count = 400
    } else if (block.type === 'list') {
      // List: min 200
      if (block.word_count < 200) block.word_count = 250
    } else {
      // Any other block: min 120
      if (block.word_count < 120) block.word_count = 150
    }
  }

  // Build title suggestions with selected: false + fix wrong years
  const currentYear = new Date().getFullYear()
  const fixYear = (text: string) => text.replace(/\b(202[0-9])\b/g, (match) => match === String(currentYear) ? match : String(currentYear))
  const stripYearFromSlug = (slug: string) => slug.replace(/[-]?(202[0-9])[-]?/g, '-').replace(/^-|-$/g, '').replace(/--+/g, '-')

  // Fix years in content block headings too
  for (const block of plan.content_blocks || []) {
    if (block.heading) {
      block.heading = fixYear(block.heading)
    }
  }

  const titleSuggestions = (plan.title_suggestions || []).map(s => ({
    title: fixYear(s.title),
    seo_title: fixYear(s.seo_title || s.title),
    slug: stripYearFromSlug(s.slug),
    seo_rationale: s.seo_rationale,
    selected: false,
  }))

  // --- Authority link suggestions (optional, wrapped in try/catch) ---
  let authorityLinkSuggestions: AuthorityLinkSuggestion[] = []
  try {
    const organicResults = (serpDataRaw?.serp?.organic || []) as { title: string; link: string; snippet?: string; domain?: string }[]

    const AUTHORITY_PATTERNS = [
      'wikipedia.org', 'gouv.fr', 'service-public.fr',
      '.edu', 'who.int', 'europa.eu', 'legifrance.gouv.fr',
      'insee.fr', 'has-sante.fr', 'ademe.fr',
      'nature.com', 'sciencedirect.com', 'springer.com',
      'lemonde.fr', 'lefigaro.fr',
    ]

    const isAuthority = (url: string) => AUTHORITY_PATTERNS.some(p => url.includes(p))

    // 1. Filter authority domains from existing SERP
    let candidates = organicResults
      .filter(r => r.link && isAuthority(r.link))
      .map(r => ({
        url: r.link,
        title: r.title || '',
        domain: r.domain || new URL(r.link).hostname,
        snippet: r.snippet || '',
      }))

    // 2. If < 2 results, do supplementary Serper query
    if (candidates.length < 2) {
      try {
        const suppSerp = await analyzeSERP(`"${article.keyword}" etude OR statistiques OR officiel`, { num: 10 })
        const suppResults = (suppSerp?.organic || []) as { title: string; link: string; snippet?: string; domain?: string }[]
        const existingUrls = new Set(candidates.map(c => c.url))
        const newCandidates = suppResults
          .filter(r => r.link && isAuthority(r.link) && !existingUrls.has(r.link))
          .map(r => ({
            url: r.link,
            title: r.title || '',
            domain: r.domain || new URL(r.link).hostname,
            snippet: r.snippet || '',
          }))
        candidates = [...candidates, ...newCandidates]
      } catch {
        // Supplementary SERP failed — continue with what we have
      }
    }

    if (candidates.length > 0) {
      // 3. HEAD-check each URL
      const validationResults = await Promise.allSettled(
        candidates.slice(0, 5).map(async (c) => {
          try {
            const res = await fetch(c.url, { method: 'HEAD', signal: AbortSignal.timeout(5000), redirect: 'follow' })
            return { ...c, is_valid: res.status >= 200 && res.status < 400 }
          } catch {
            return { ...c, is_valid: false }
          }
        })
      )
      const checkedCandidates = validationResults
        .filter((r): r is PromiseFulfilledResult<typeof candidates[0] & { is_valid: boolean }> => r.status === 'fulfilled')
        .map(r => r.value)

      // 4. Gemini Flash to pick top 2-3 with rationale
      const evalPrompt = `Tu es un expert SEO. Voici des sources potentielles d'autorite pour un article sur "${article.keyword}".

Candidats :
${checkedCandidates.map((c, i) => `${i + 1}. ${c.title} (${c.domain}) — ${c.snippet.slice(0, 150)}`).join('\n')}

Selectionne les 2-3 meilleures sources pour renforcer l'E-E-A-T de l'article.
Pour chaque source selectionnee, fournis :
- rationale : pourquoi cette source renforce la credibilite (1 phrase)
- anchor_context : suggestion de phrase dans laquelle integrer le lien (1 phrase)

Retourne UNIQUEMENT un JSON valide :
{
  "selections": [
    { "index": 0, "rationale": "...", "anchor_context": "..." }
  ]
}
Pas de texte avant ou apres le JSON.`

      const evalResponse = await routeAI('evaluate_authority_links', [{ role: 'user', content: evalPrompt }])
      const evalParsed = extractJSON<{ selections: { index: number; rationale: string; anchor_context: string }[] }>(evalResponse.content)

      authorityLinkSuggestions = (evalParsed.selections || [])
        .filter(s => checkedCandidates[s.index])
        .map(s => ({
          url: checkedCandidates[s.index].url,
          title: checkedCandidates[s.index].title,
          domain: checkedCandidates[s.index].domain,
          snippet: checkedCandidates[s.index].snippet,
          rationale: s.rationale,
          is_valid: checkedCandidates[s.index].is_valid,
          selected: false,
        }))
    }
  } catch {
    // Authority links are optional — don't break the plan step
  }

  // Update article with the generated plan — title, slug, seo_title are null until user selects one
  await supabase
    .from('seo_articles')
    .update({
      title: null,
      slug: null,
      seo_title: null,
      meta_description: fixYear(plan.meta_description || ''),
      content_blocks: plan.content_blocks,
      title_suggestions: titleSuggestions,
      authority_link_suggestions: authorityLinkSuggestions.length > 0 ? authorityLinkSuggestions : null,
      selected_authority_link: null,
      year_tag: new Date().getFullYear(),
      status: 'planning' as ArticleStatus,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      titleSuggestions,
      blocksCount: plan.content_blocks.length,
      estimatedWordCount: plan.content_blocks.reduce((sum: number, b: ContentBlock) => sum + (b.word_count || 0), 0),
    },
    tokensIn: aiResponse.tokensIn,
    tokensOut: aiResponse.tokensOut,
    costUsd: estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model),
    modelUsed: aiResponse.model,
  }
}

async function executeWriteBlock(
  article: ArticleWithRelations,
  input?: Record<string, unknown>,
  modelOverride?: Partial<ModelConfig>,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const blockIndex = (input?.blockIndex as number) ?? 0

  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const block = contentBlocks[blockIndex]
  if (!block) {
    return { success: false, runId: '', error: `Bloc #${blockIndex} introuvable` }
  }

  // Smart nugget fetching:
  // 1. Use nugget_ids assigned by the plan-architect (if any)
  // 2. Fallback: match nuggets by tag overlap with article keyword
  // Deduplication: exclude nuggets already used in previous blocks (usedNuggetIds)
  let matchedNuggets: { id: string; content: string; tags: string[] }[] = []
  const usedNuggetIds = new Set<string>((input?.usedNuggetIds as string[]) || [])

  const planNuggetIds = (block.nugget_ids || []).filter(id => !usedNuggetIds.has(id))
  if (planNuggetIds.length > 0) {
    // Priority: use nuggets assigned by the plan (excluding already used)
    const { data } = await supabase
      .from('seo_nuggets')
      .select('id, content, tags')
      .in('id', planNuggetIds)
    matchedNuggets = (data || []) as { id: string; content: string; tags: string[] }[]
  }

  if (matchedNuggets.length === 0) {
    // Fallback: fetch site nuggets and rank by keyword relevance
    const { data: allNuggets } = await supabase
      .from('seo_nuggets')
      .select('id, content, tags')
      .or(`site_id.eq.${article.site_id},site_id.is.null`)
      .limit(50)

    if (allNuggets && allNuggets.length > 0) {
      const keywordWords = article.keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const headingWords = (block.heading || '').toLowerCase().split(/\s+/).filter(w => w.length > 3)

      // Score each nugget by tag + content overlap with keyword/heading
      // Keyword words get higher weight (5 pts) vs heading words (2 pts)
      const scored = (allNuggets as { id: string; content: string; tags: string[] }[])
        .filter(n => !usedNuggetIds.has(n.id))
        .map(n => {
          let score = 0
          const tagStr = (n.tags || []).join(' ').toLowerCase()
          const contentStr = n.content.toLowerCase()
          for (const word of keywordWords) {
            if (word.length < 3) continue
            if (tagStr.includes(word)) score += 5
            if (contentStr.includes(word)) score += 2
          }
          for (const word of headingWords) {
            if (word.length < 3) continue
            if (tagStr.includes(word)) score += 2
            if (contentStr.includes(word)) score += 1
          }
          return { ...n, score }
        })

      // Higher threshold (>=6) to avoid weak matches, max 2 nuggets in fallback mode
      matchedNuggets = scored
        .filter(n => n.score >= 6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ score: _s, ...n }) => n)
    }
  }

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null; avatar_reference_url: string | null; writing_style_examples: Record<string, unknown>[] } | null
  const previousHeadings = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.heading)
    .map((b: ContentBlock) => b.heading!)

  // Extract internal link targets from the block (set by the plan)
  const internalLinkTargets = block.internal_link_targets || []
  const siteDomain = article.seo_sites?.domain

  // Authority link injection: only in the first H2 (non-FAQ) that doesn't already contain it
  const selectedAuth = article.selected_authority_link as SelectedAuthorityLink | null
  const alreadyPlaced = contentBlocks
    .slice(0, blockIndex)
    .some(b => b.content_html?.includes(selectedAuth?.url || '___'))
  const shouldInjectAuth = selectedAuth && block.type === 'h2' && !alreadyPlaced

  // Get the content of the immediately preceding written block for coherence
  let previousBlockContent: string | undefined
  for (let i = blockIndex - 1; i >= 0; i--) {
    const prev = contentBlocks[i]
    if (prev.content_html && (prev.status === 'written' || prev.status === 'approved')) {
      previousBlockContent = prev.content_html
      break
    }
  }

  // Build full article outline for MECE context injection
  const articleOutline = contentBlocks
    .filter((b: ContentBlock) => b.heading || b.type === 'paragraph')
    .map((b: ContentBlock, idx: number) => {
      const prefix = b.type === 'paragraph' && !b.heading ? 'Intro' : b.type.toUpperCase()
      const ideas = b.key_ideas?.length ? ` → [${b.key_ideas.join(' | ')}]` : ''
      return `${idx + 1}. [${prefix}] ${b.heading || '(intro)'}${ideas}`
    })
    .join('\n')

  // Build cumulative digest of ALL previously written sections to prevent repetition
  let articleDigest: string | undefined
  const writtenBefore = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.content_html && (b.status === 'written' || b.status === 'approved'))
  if (writtenBefore.length >= 2) {
    // Extract key ideas from each section: heading + plain text summary (500 chars max each)
    const digestParts = writtenBefore.map((b: ContentBlock) => {
      const plain = (b.content_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const summary = plain.slice(0, 500) + (plain.length > 500 ? '...' : '')
      return `- [${b.heading || 'Intro'}] ${summary}`
    })
    articleDigest = digestParts.join('\n')
  }

  const prompt = buildBlockWriterPrompt({
    keyword: article.keyword,
    searchIntent: article.search_intent,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null, avatar_reference_url: null, writing_style_examples: [] },
    block: {
      type: block.type,
      heading: block.heading ?? null,
      word_count: block.word_count,
      writing_directive: block.writing_directive,
      format_hint: block.format_hint,
    },
    nuggets: matchedNuggets.map(n => ({ id: n.id, content: n.content, tags: n.tags })),
    previousHeadings,
    previousBlockContent,
    articleDigest,
    articleTitle: article.title || article.keyword,
    internalLinkTargets,
    siteDomain: siteDomain || undefined,
    authorityLink: shouldInjectAuth ? selectedAuth : null,
    tableStyleIndex: (() => {
      // Count how many tables exist in previously written blocks to alternate styles
      let tableCount = 0
      for (let i = 0; i < blockIndex; i++) {
        const b = contentBlocks[i]
        if (b.content_html && (b.status === 'written' || b.status === 'approved')) {
          // Count <table occurrences in the block content
          const matches = b.content_html.match(/<table[\s>]/g)
          if (matches) tableCount += matches.length
        }
      }
      // Also account for tables that will be in the current block (format_hint === 'table' counts as 1)
      return tableCount
    })(),
    calloutStyleIndex: (() => {
      // Count how many expert callouts exist in previously written blocks to alternate styles
      let calloutCount = 0
      for (let i = 0; i < blockIndex; i++) {
        const b = contentBlocks[i]
        if (b.content_html && (b.status === 'written' || b.status === 'approved')) {
          const matches = b.content_html.match(/class="expert-callout"/g)
          if (matches) calloutCount += matches.length
        }
      }
      return calloutCount
    })(),
    blockPosition: (() => {
      // Determine block position in article for condensation rules
      const totalContentBlocks = contentBlocks.filter((b: ContentBlock) => b.type !== 'image').length
      const currentContentIndex = contentBlocks.slice(0, blockIndex).filter((b: ContentBlock) => b.type !== 'image').length
      if (totalContentBlocks <= 2) return 'early' as const
      const ratio = currentContentIndex / totalContentBlocks
      if (ratio < 0.35) return 'early' as const
      if (ratio < 0.65) return 'middle' as const
      return 'late' as const
    })(),
    totalBlocks: contentBlocks.filter((b: ContentBlock) => b.type !== 'image').length,
    articleOutline,
    blockKeyIdeas: block.key_ideas || [],
  })

  const aiResponse = modelOverride
    ? await routeAIWithOverrides('write_block', [{ role: 'user', content: prompt.user }], prompt.system, modelOverride)
    : await routeAI('write_block', [{ role: 'user', content: prompt.user }], prompt.system)

  // Guard: ensure AI returned content
  if (!aiResponse.content) {
    throw new Error(`L'IA n'a retourne aucun contenu pour le bloc ${blockIndex} (modele: ${aiResponse.model || 'inconnu'})`)
  }

  // Post-process: fix expert callout avatars — AI often generates letter fallback instead of <img>
  let processedHtml = aiResponse.content
  if (processedHtml.includes('expert-callout') && persona?.avatar_reference_url) {
    // Replace letter-circle fallback with actual persona avatar image
    processedHtml = processedHtml.replace(
      /<div\s+style="[^"]*width:52px;height:52px;border-radius:50%[^"]*display:flex;align-items:center;justify-content:center[^"]*">[A-Z]<\/div>/g,
      `<img src="${persona.avatar_reference_url}" alt="${persona.name}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid currentColor" />`
    )
  }

  // Update the specific block
  const updatedBlocks = [...contentBlocks]
  updatedBlocks[blockIndex] = {
    ...block,
    content_html: processedHtml,
    status: 'written' as const,
    model_used: aiResponse.model,
    word_count: countWords(processedHtml),
  }

  // Calculate total word count
  const totalWords = updatedBlocks.reduce((sum: number, b: ContentBlock) => sum + (b.word_count || 0), 0)
  const writtenCount = updatedBlocks.filter((b: ContentBlock) => b.status === 'written' || b.status === 'approved').length

  // Update article - transition to 'writing' status if not already
  await supabase
    .from('seo_articles')
    .update({
      content_blocks: updatedBlocks,
      word_count: totalWords,
      status: 'writing' as ArticleStatus,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      blockIndex,
      blockType: block.type,
      wordCount: countWords(aiResponse.content),
      writtenBlocks: writtenCount,
      totalBlocks: updatedBlocks.length,
      nuggetIdsUsed: matchedNuggets.map(n => n.id),
    },
    tokensIn: aiResponse.tokensIn,
    tokensOut: aiResponse.tokensOut,
    costUsd: estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model),
    modelUsed: aiResponse.model,
  }
}

// ---- Media step ----

async function executeMedia(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const uploadedImages: { blockIndex: number; url: string; mediaId: number }[] = []

  // 1. Generate hero image
  let heroMediaId: number | undefined
  try {
    const heroResult = await generateHeroImage(article.keyword, article.title || article.keyword)
    const heroBuffer = await fetch(heroResult.url).then(r => r.arrayBuffer())
    const optimized = await optimizeForWeb(Buffer.from(heroBuffer))
    const filename = generateSeoFilename(article.keyword, null, 'hero')
    const altText = generateAltText(article.keyword, null, 'hero')

    const wpMedia = await uploadMedia(article.site_id, {
      buffer: optimized.buffer,
      filename,
      altText,
      title: `${article.title || article.keyword} - Image principale`,
      caption: altText,
    })
    heroMediaId = wpMedia.mediaId
    // Store hero image URL for JSON-LD schema
    await supabase
      .from('seo_articles')
      .update({ hero_image_url: wpMedia.url })
      .eq('id', article.id)
  } catch (error) {
    // Hero image generation is optional - continue with blocks
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('non configure') && !msg.includes('FAL_KEY')) throw error
  }

  // 2. Generate images for 'image' type blocks AND H2/H3 blocks with generate_image === true
  //    Minimum 5 section images obligatoire, max 8 total (hero incluse)
  const MIN_SECTION_IMAGES = 5
  const MAX_IMAGES = 8
  const maxSectionImages = MAX_IMAGES - (heroMediaId ? 1 : 0)

  const updatedBlocks = [...contentBlocks]

  // Guard: force generate_image on the first H2 (visual break after intro)
  const firstH2Idx = updatedBlocks.findIndex((b) => b.type === 'h2')
  if (firstH2Idx !== -1 && !updatedBlocks[firstH2Idx].generate_image) {
    updatedBlocks[firstH2Idx] = { ...updatedBlocks[firstH2Idx], generate_image: true }
    if (!updatedBlocks[firstH2Idx].image_prompt_hint) {
      updatedBlocks[firstH2Idx] = {
        ...updatedBlocks[firstH2Idx],
        image_prompt_hint: `Editorial photo illustrating ${article.keyword}, professional style`,
      }
    }
  }

  // Guard: ensure at least MIN_SECTION_IMAGES blocks have generate_image: true
  // If AI didn't flag enough, force it on H2/H3 blocks evenly spaced
  const currentImageCount = updatedBlocks.filter(
    (b) => (b.generate_image === true && (b.type === 'h2' || b.type === 'h3')) || b.type === 'image'
  ).length
  if (currentImageCount < MIN_SECTION_IMAGES) {
    const eligibleIndices = updatedBlocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) =>
        (b.type === 'h2' || b.type === 'h3') &&
        !b.generate_image &&
        b.type !== 'faq' as string &&
        !hasContentImage(b.content_html || '')
      )
      .map(({ i }) => i)

    const needed = MIN_SECTION_IMAGES - currentImageCount
    // Pick evenly spaced blocks from eligible
    const toForce = eligibleIndices.length <= needed
      ? eligibleIndices
      : Array.from({ length: needed }, (_, s) =>
          eligibleIndices[Math.round(s * (eligibleIndices.length - 1) / (needed - 1))]
        )

    for (const idx of toForce) {
      updatedBlocks[idx] = {
        ...updatedBlocks[idx],
        generate_image: true,
        image_prompt_hint: updatedBlocks[idx].image_prompt_hint ||
          `Editorial photo illustrating ${updatedBlocks[idx].heading || article.keyword}, professional style`,
      }
    }
  }

  // Collect all candidate block indices
  // Helper: check if block has a real content image (not just an avatar in expert callout)
  function hasContentImage(html: string): boolean {
    if (!html) return false
    // Remove all avatar <img> tags (persona callout images with border-radius:50%)
    const withoutAvatars = html.replace(/<img[^>]*border-radius:\s*50%[^>]*>/gi, '')
    return withoutAvatars.includes('<img')
  }

  const candidates: number[] = []
  for (let i = 0; i < updatedBlocks.length; i++) {
    const block = updatedBlocks[i]
    const isImageBlock = block.type === 'image' && !hasContentImage(block.content_html || '')
    const isH2WithImage = (block.type === 'h2' || block.type === 'h3') && block.generate_image === true && !hasContentImage(block.content_html || '')
    if (isImageBlock || isH2WithImage) candidates.push(i)
  }

  // Select up to maxSectionImages candidates, evenly spaced (minimum MIN_SECTION_IMAGES)
  let selectedIndices: Set<number>
  if (candidates.length <= maxSectionImages) {
    selectedIndices = new Set(candidates)
  } else {
    selectedIndices = new Set<number>()
    for (let s = 0; s < maxSectionImages; s++) {
      const idx = Math.round(s * (candidates.length - 1) / (maxSectionImages - 1))
      selectedIndices.add(candidates[idx])
    }
  }

  // Build generation tasks for all selected blocks (will run in parallel)
  const selectedList = Array.from(selectedIndices)
  interface ImageTask {
    blockIndex: number
    isImageBlock: boolean
    prompt: string
    heading: string | null
    imageHint?: string
    sectionImageIdx: number
  }
  const imageTasks: ImageTask[] = []
  for (let s = 0; s < selectedList.length; s++) {
    const i = selectedList[s]
    const block = updatedBlocks[i]
    const isImageBlock = block.type === 'image' && !hasContentImage(block.content_html || '')

    // Gather section context
    let sectionContent = block.content_html || ''
    if (block.type === 'h2') {
      for (let j = i + 1; j < updatedBlocks.length; j++) {
        if (updatedBlocks[j].type === 'h2') break
        if (updatedBlocks[j].content_html) sectionContent += ' ' + updatedBlocks[j].content_html
      }
    } else if (block.type === 'image') {
      for (let j = i - 1; j >= 0; j--) {
        if (updatedBlocks[j].type === 'h2') {
          sectionContent = updatedBlocks[j].content_html || ''
          for (let k = j + 1; k < i; k++) {
            if (updatedBlocks[k].content_html) sectionContent += ' ' + updatedBlocks[k].content_html
          }
          break
        }
      }
    }

    imageTasks.push({
      blockIndex: i,
      isImageBlock,
      prompt: buildImagePrompt(article.keyword, block.heading || '', sectionContent, block.image_prompt_hint, article.title || article.keyword),
      heading: block.heading || null,
      imageHint: block.image_prompt_hint,
      sectionImageIdx: s,
    })
  }

  // Run all image generations in parallel (fal.ai + optimize + WP upload)
  const imageResults = await Promise.allSettled(
    imageTasks.map(async (task) => {
      const imageResult = await generateImage(task.prompt, { aspectRatio: "16:9" })
      const imgBuffer = await fetch(imageResult.url).then(r => r.arrayBuffer())
      const optimized = await optimizeForWeb(Buffer.from(imgBuffer))
      const filename = generateSeoFilename(article.keyword, task.heading, 'section')
      const altText = generateAltText(article.keyword, task.heading, 'section', task.imageHint, task.sectionImageIdx)
      const imgTitle = generateImageTitle(article.keyword, task.heading, 'section')

      const wpMedia = await uploadMedia(article.site_id, {
        buffer: optimized.buffer,
        filename,
        altText,
        title: imgTitle,
        caption: altText,
      })
      return { ...task, wpMedia, altText, imgTitle, optimized }
    })
  )

  // Apply successful results to blocks
  for (const result of imageResults) {
    if (result.status !== 'fulfilled') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      if (!reason.includes('non configure') && !reason.includes('FAL_KEY')) {
        console.warn('[media] Image generation failed:', reason)
      }
      continue
    }
    const { blockIndex, isImageBlock, wpMedia, altText, imgTitle, optimized } = result.value
    const block = updatedBlocks[blockIndex]

    if (isImageBlock) {
      updatedBlocks[blockIndex] = {
        ...block,
        content_html: `<figure><img src="${wpMedia.url}" alt="${altText}" title="${imgTitle}" width="${optimized.width}" height="${optimized.height}" loading="lazy" />${block.heading ? `<figcaption>${block.heading}</figcaption>` : ''}</figure>`,
        status: 'written' as const,
      }
    } else {
      const imageHtml = `<figure class="section-image"><img src="${wpMedia.url}" alt="${altText}" title="${imgTitle}" width="${optimized.width}" height="${optimized.height}" loading="lazy" /></figure>`
      updatedBlocks[blockIndex] = {
        ...block,
        content_html: imageHtml + (block.content_html || ''),
      }
    }

    uploadedImages.push({ blockIndex, url: wpMedia.url, mediaId: wpMedia.mediaId })
  }

  // 3. Update article
  await supabase
    .from('seo_articles')
    .update({
      content_blocks: updatedBlocks,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      heroMediaId,
      imagesGenerated: uploadedImages.length,
      uploadedImages,
    },
  }
}

// ---- SEO step ----

async function executeSeo(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const persona = article.seo_personas
  const site = article.seo_sites

  // 1. Generate JSON-LD schemas
  const schemas: Record<string, unknown>[] = []

  // Article schema
  const articleSchema = generateArticleSchema({
    title: article.title || article.keyword,
    description: article.meta_description || '',
    slug: article.slug || '',
    siteDomain: site?.domain || '',
    personaName: persona?.name || 'Expert',
    personaRole: persona?.role || 'Redacteur',
    publishedAt: article.published_at,
    updatedAt: article.updated_at,
    wordCount: article.word_count,
    imageUrl: (article as Record<string, unknown>).hero_image_url as string | undefined,
  })
  schemas.push(articleSchema)

  // FAQ schema (parse individual Q/A from <details>/<summary> in FAQ blocks)
  const faqBlocks = contentBlocks.filter(b => b.type === 'faq' && b.content_html)
  if (faqBlocks.length > 0) {
    const faqItems: { question: string; answer: string }[] = []
    const summaryRegex = /<summary[^>]*>([\s\S]*?)<\/summary>/gi
    const detailsRegex = /<details[^>]*>([\s\S]*?)<\/details>/gi

    for (const block of faqBlocks) {
      let detailsMatch
      while ((detailsMatch = detailsRegex.exec(block.content_html)) !== null) {
        const detailsInner = detailsMatch[1]
        const summaryMatch = summaryRegex.exec(detailsInner)
        if (summaryMatch) {
          const question = summaryMatch[1].replace(/<[^>]*>/g, '').trim()
          const answer = detailsInner
            .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
            .replace(/<[^>]*>/g, '')
            .trim()
          if (question && answer) {
            faqItems.push({ question, answer })
          }
        }
        summaryRegex.lastIndex = 0
      }
      detailsRegex.lastIndex = 0
    }

    const faqSchema = generateFAQSchema(faqItems)
    if (faqSchema) schemas.push(faqSchema)
  }

  // Breadcrumb schema
  const breadcrumb = generateBreadcrumbSchema(
    site?.domain || '',
    site?.name || '',
    article.title || article.keyword,
    article.slug || '',
    (site as Record<string, unknown> | null)?.blog_path as string | null,
  )
  schemas.push(breadcrumb)

  // HowTo schema — for informational/traffic articles with H2 step-like sections
  const intent = article.search_intent
  if (intent === 'informational' || intent === 'traffic') {
    const h2Blocks = contentBlocks.filter(b => b.type === 'h2' && b.heading && b.content_html && b.status !== 'pending')
    if (h2Blocks.length >= 3) {
      const steps = h2Blocks.map(b => ({
        name: b.heading || '',
        text: b.content_html.replace(/<[^>]*>/g, '').trim().slice(0, 300),
      }))
      const howTo = generateHowToSchema(
        article.title || article.keyword,
        article.meta_description || '',
        steps,
      )
      if (howTo) schemas.push(howTo)
    }
  }

  // Review schema — for review/comparison articles
  if (intent === 'review' || intent === 'comparison') {
    const reviewSchema = generateReviewSchema(
      article.keyword,
      article.meta_description || '',
      persona?.name || 'Expert',
    )
    schemas.push(reviewSchema)
  }

  const jsonLd = assembleJsonLd(schemas)

  // 2. Internal links (silo + WordPress sitemap)
  let linksInjected = 0
  let updatedBlocks = [...contentBlocks]

  // Pre-scan: extract slugs already linked by the AI during write-step
  const existingLinkSlugs = new Set<string>()
  const hrefRegex = /<a\s[^>]*href=["']([^"']+)["']/gi
  const allWrittenHtml = updatedBlocks.filter(b => b.content_html).map(b => b.content_html).join(' ')
  let hrefMatch: RegExpExecArray | null
  while ((hrefMatch = hrefRegex.exec(allWrittenHtml)) !== null) {
    try {
      const url = new URL(hrefMatch[1], `https://${site?.domain || 'x.com'}`)
      existingLinkSlugs.add(url.pathname.replace(/^\/|\/$/g, ''))
    } catch { /* skip malformed */ }
  }

  // Gather links from silo DB
  const linksToInject: { anchorText: string; url: string }[] = []
  if (article.silo_id) {
    const linkSuggestions = await generateInternalLinks(article.id, article.silo_id, article.site_id)
    for (const l of linkSuggestions) {
      if (l.targetSlug) {
        if (existingLinkSlugs.has(l.targetSlug)) continue
        linksToInject.push({
          anchorText: l.anchorText,
          url: `https://${site?.domain || ''}/${l.targetSlug}`,
        })
      }
    }
  }

  // Also find WP sitemap links that match content keywords
  try {
    const wpPosts = await getAllPublishedPosts(article.site_id)
    const currentContent = updatedBlocks
      .filter(b => b.content_html)
      .map(b => b.content_html.toLowerCase())
      .join(' ')
    const existingSlugs = new Set(linksToInject.map(l => new URL(l.url).pathname.replace(/^\/|\/$/g, '')))

    for (const post of wpPosts) {
      if (linksToInject.length >= 8) break
      if (existingSlugs.has(post.slug)) continue
      if (existingLinkSlugs.has(post.slug)) continue
      if (post.slug === article.slug) continue

      // Check if the post title words appear in our content
      const titleWords = post.title.toLowerCase().split(/\s+/).filter(w => w.length >= 4)
      const matchCount = titleWords.filter(w => currentContent.includes(w)).length
      if (matchCount >= 2) {
        linksToInject.push({
          anchorText: post.title,
          url: post.link || `https://${site?.domain || ''}/${post.slug}`,
        })
        existingSlugs.add(post.slug)
      }
    }
  } catch {
    // WordPress not reachable — continue with silo links only
  }

  if (linksToInject.length > 0) {
    updatedBlocks = updatedBlocks.map(block => {
      if (block.content_html && block.type !== 'image') {
        const newHtml = injectLinksIntoHtml(block.content_html, linksToInject)
        if (newHtml !== block.content_html) {
          linksInjected++
          return { ...block, content_html: newHtml }
        }
      }
      return block
    })
  }

  // 3. Re-generate meta description from actual written content (Gemini Flash)
  let metaDesc = article.meta_description || ''
  let metaRegenerated = false
  try {
    const writtenText = updatedBlocks
      .filter(b => b.content_html && b.status !== 'pending')
      .map(b => b.content_html.replace(/<[^>]*>/g, ''))
      .join(' ')
      .slice(0, 2000)

    if (writtenText.length > 200) {
      const metaResponse = await routeAI('generate_meta', [{
        role: 'user',
        content: [
          `Genere une meta description SEO optimisee pour cet article.`,
          `Mot-cle principal : "${article.keyword}"`,
          `Titre : "${article.title || article.keyword}"`,
          `Contenu (extrait) : ${writtenText}`,
          ``,
          `Regles :`,
          `- Exactement 140-155 caracteres (CRITIQUE)`,
          `- Inclure le mot-cle "${article.keyword}" naturellement`,
          `- Inciter au clic (promesse de valeur, chiffre ou question)`,
          `- Pas de guillemets francais, pas de tirets cadratins`,
          `- Reponds UNIQUEMENT avec la meta description, rien d'autre`,
        ].join('\n'),
      }])
      const newMeta = metaResponse.content.trim().replace(/^["']|["']$/g, '')
      if (newMeta.length >= 100 && newMeta.length <= 170) {
        metaDesc = newMeta
        metaRegenerated = true
      }
    }
  } catch {
    // Keep existing meta description on error
  }

  const metaDescLength = metaDesc.length
  const metaDescOk = metaDescLength >= 120 && metaDescLength <= 160

  // 4. Calculate nugget density
  const blocksWithNuggets = contentBlocks.filter(b => b.nugget_ids && b.nugget_ids.length > 0).length
  const nuggetDensity = contentBlocks.length > 0 ? blocksWithNuggets / contentBlocks.length : 0

  // 5. SEO Audit — sub-step A: programmatic heading verification
  const headingIssues: string[] = []
  const headingBlocks = updatedBlocks.filter(
    (b) => b.type === 'h2' || b.type === 'h3' || b.type === 'h4'
  )
  const h2Blocks = headingBlocks.filter((b) => b.type === 'h2')

  // Check heading lengths
  for (const block of headingBlocks) {
    if (block.heading && block.heading.length > 80) {
      headingIssues.push(
        `${block.type.toUpperCase()} trop long (${block.heading.length} chars) : "${block.heading.slice(0, 60)}…"`
      )
    }
  }

  // Check keyword in at least one H2
  const kwWords = article.keyword.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  const hasKeywordInH2 = h2Blocks.some((b) => {
    if (!b.heading) return false
    const headingLower = b.heading.toLowerCase()
    return kwWords.filter((w) => headingLower.includes(w)).length >= Math.ceil(kwWords.length * 0.5)
  })
  if (!hasKeywordInH2 && h2Blocks.length > 0) {
    headingIssues.push(
      `Aucun H2 ne contient le mot-cle principal "${article.keyword}" (au moins un H2 devrait l'inclure)`
    )
  }

  // Check heading hierarchy (no H3 without H2 parent, no H4 without H3 parent)
  let lastH2Seen = false
  let lastH3Seen = false
  for (const block of updatedBlocks) {
    if (block.type === 'h2') {
      lastH2Seen = true
      lastH3Seen = false
    } else if (block.type === 'h3') {
      if (!lastH2Seen) {
        headingIssues.push(
          `H3 "${block.heading?.slice(0, 50) || '(sans titre)'}" apparait avant tout H2 (hierarchie cassee)`
        )
      }
      lastH3Seen = true
    } else if (block.type === 'h4') {
      if (!lastH3Seen) {
        headingIssues.push(
          `H4 "${block.heading?.slice(0, 50) || '(sans titre)'}" apparait sans H3 parent (hierarchie cassee)`
        )
      }
    }
  }

  // Check H2 count
  if (h2Blocks.length < 3) {
    headingIssues.push(`Seulement ${h2Blocks.length} H2 detecte(s) — minimum recommande : 3`)
  } else if (h2Blocks.length > 8) {
    headingIssues.push(`${h2Blocks.length} H2 detectes — maximum recommande : 8 (risque de dilution)`)
  }

  // 5b. SEO Audit — sub-step B: keyword density analysis
  const writtenHtml = updatedBlocks
    .filter((b) => b.content_html && b.status !== 'pending')
    .map((b) => b.content_html)
    .join(' ')
  const keywordDensityResult = analyzeKeywordDensity(writtenHtml, article.keyword)

  // Check keyword in first 100 words of intro
  const introBlock = updatedBlocks.find(
    (b) => b.type === 'paragraph' && !b.heading && b.content_html && b.status !== 'pending'
  )
  let keywordInIntro = false
  if (introBlock) {
    const introText = introBlock.content_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const first100Words = introText.split(/\s+/).slice(0, 100).join(' ').toLowerCase()
    keywordInIntro = first100Words.includes(article.keyword.toLowerCase())
  }

  // 5c. SEO Audit — sub-step C: AI critique
  let critiqueResult = null
  try {
    const fullContentHtml = updatedBlocks
      .filter((b) => b.content_html && b.status !== 'pending')
      .map((b) => {
        if (b.heading) return `<${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'p'}>${b.heading}</${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'p'}>\n${b.content_html}`
        return b.content_html
      })
      .join('\n')
      // Strip CSS blocks, WP spacers, and figure wrappers to reduce noise for critique
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--\s*wp:spacer[\s\S]*?-->/gi, '')
      .replace(/<div[^>]*style="height:\d+px"[^>]*><\/div>/gi, '')
      .replace(/<figure[^>]*class="[^"]*section-image[^"]*"[^>]*>[\s\S]*?<\/figure>/gi, '')

    if (fullContentHtml.length > 500 && persona) {
      const critiquePrompts = buildCritiquePrompt({
        keyword: article.keyword,
        searchIntent: article.search_intent || undefined,
        title: article.title || article.keyword,
        contentHtml: fullContentHtml,
        persona: {
          name: persona.name,
          role: persona.role,
          tone_description: persona.tone_description,
          bio: persona.bio,
        },
      })

      const critiqueResponse = await routeAI('critique', [
        { role: 'user', content: critiquePrompts.user },
      ], critiquePrompts.system)

      const parsed = extractJSON<Record<string, unknown>>(critiqueResponse.content)
      critiqueResult = validateCritiqueResult(parsed)
    }
  } catch (err) {
    console.warn('[seo-audit] Critique AI failed, skipping:', err)
  }

  // 5c-bis. SEO Audit — Persona voice consistency check
  let personaConsistency: { score: number; drifts: { blockIndex: number; heading: string; issue: string }[] } | null = null
  try {
    if (persona && persona.tone_description) {
      const blocksForCheck = updatedBlocks
        .filter((b) => b.content_html && b.status !== 'pending' && b.type !== 'image')
        .map((b, i) => {
          const plain = b.content_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
          return `[Bloc ${i}${b.heading ? ' — ' + b.heading : ''}]\n${plain}`
        })
        .join('\n\n')

      if (blocksForCheck.length > 200) {
        const consistencyPrompt = `Tu es un expert en analyse de style editorial.

## PERSONA DE REFERENCE
- Nom : ${persona.name}
- Role : ${persona.role}
- Ton : ${persona.tone_description}
${persona.bio ? `- Bio : ${persona.bio}` : ''}

## ARTICLE A ANALYSER
${blocksForCheck}

## MISSION
Analyse la coherence de la voix du persona a travers tous les blocs de l'article.

Evalue :
1. Le niveau de langue est-il constant ? (technique vs vulgarise)
2. Le vocabulaire metier est-il coherent ?
3. Y a-t-il des blocs ou le ton change brusquement (trop generique, trop academique, etc.) ?
4. Les tournures personnelles du persona sont-elles presentes regulierement ?

Retourne UNIQUEMENT un JSON valide :
{
  "score": 85,
  "drifts": [
    { "block_index": 3, "heading": "...", "issue": "Le ton devient trop academique, perd le cote pratique du persona" }
  ]
}

- score : 0-100 (100 = parfaitement coherent)
- drifts : liste des blocs ou la voix decroche (peut etre vide si tout est coherent)
- Maximum 5 drifts les plus significatifs`

        const consistencyResponse = await routeAI('check_persona_consistency', [
          { role: 'user', content: consistencyPrompt },
        ])

        const parsed = extractJSON<{ score: number; drifts: { block_index: number; heading: string; issue: string }[] }>(consistencyResponse.content)
        if (parsed && typeof parsed.score === 'number') {
          personaConsistency = {
            score: parsed.score,
            drifts: (parsed.drifts || []).map(d => ({
              blockIndex: d.block_index,
              heading: d.heading || '',
              issue: d.issue || '',
            })),
          }
        }
      }
    }
  } catch (err) {
    console.warn('[seo-audit] Persona consistency check failed, skipping:', err)
  }

  // 5d. SEO Audit — sub-step D: auto-correct problematic headings
  // Detect H2 without semantic anchor (vague/generic headings like "Les avantages", "Notre avis")
  const vagueH2Patterns = /^(les |l'|la |le |un |une |des |nos? |mon |mes |notre |votre |du |au |ce qu|en |a )?(avantages?|inconvenients?|avis|conseil|astuces?|erreurs?|points?|conclusion|introduction|analyse|focus|details?|resume|bilan|verdict|comparatif|guide|pratique|bonus|essentiel|important)s?\s*$/i
  const headingCorrections: { before: string; after: string; blockIndex: number }[] = []
  const faultyHeadings = headingBlocks.filter((b) => {
    if (!b.heading) return false
    // Too long
    if (b.heading.length > 80) return true
    // Missing keyword in any H2 if no H2 has it
    if (b.type === 'h2' && !hasKeywordInH2) return true
    // Vague/generic H2 without semantic anchor (no keyword, no TF-IDF term, no specificity)
    if (b.type === 'h2' && vagueH2Patterns.test(b.heading.trim())) return true
    return false
  })

  if (faultyHeadings.length > 0) {
    try {
      const headingFixPrompt = [
        `Corrige les titres (headings) suivants d'un article SEO sur "${article.keyword}".`,
        ``,
        `Regles :`,
        `- Maximum 70 caracteres par heading`,
        `- Au moins 2 H2 doivent contenir le mot-cle "${article.keyword}" ou une variante semantique tres proche`,
        `- Chaque H2 DOIT contenir le mot-cle OU un terme semantique du domaine (JAMAIS de H2 generique sans ancrage)`,
        `- Formules optimisees : "[Verbe d'action] + [mot-cle/variante] + [qualificateur]" ou "[Question mot-cle] + [precision]"`,
        `- INTERDIT : "Les avantages", "Notre avis", "Conseils", "Erreurs" seuls — toujours ajouter le mot-cle ou un qualificateur specifique`,
        `- Garde le sens et l'intention du heading original`,
        `- Pas de guillemets francais, pas de tirets cadratins`,
        `- Reponds UNIQUEMENT en JSON : [{ "original": "...", "corrected": "..." }, ...]`,
        ``,
        `Headings a corriger :`,
        ...faultyHeadings.map(
          (b) => `- [${b.type.toUpperCase()}] "${b.heading}"`
        ),
      ].join('\n')

      const fixResponse = await routeAI('generate_title', [
        { role: 'user', content: headingFixPrompt },
      ])

      const fixes = extractJSON<{ original: string; corrected: string }[]>(fixResponse.content)
      if (Array.isArray(fixes)) {
        for (const fix of fixes) {
          const blockIdx = updatedBlocks.findIndex(
            (b) => b.heading === fix.original
          )
          if (blockIdx !== -1 && fix.corrected && fix.corrected !== fix.original) {
            headingCorrections.push({
              before: fix.original,
              after: fix.corrected,
              blockIndex: blockIdx,
            })
            updatedBlocks[blockIdx] = {
              ...updatedBlocks[blockIdx],
              heading: fix.corrected,
            }
          }
        }
      }
    } catch (err) {
      console.warn('[seo-audit] Heading correction failed, skipping:', err)
    }
  }

  // 5d-bis. Auto-condense blocks in the last third of the article if too long
  const contentBlocksOnly = updatedBlocks.filter((b) => b.type !== 'image' && b.content_html && b.status !== 'pending')
  const totalContentBlocksCount = contentBlocksOnly.length
  const lastThirdStart = Math.floor(totalContentBlocksCount * 0.65)
  let condensedCount = 0

  for (let i = 0; i < updatedBlocks.length; i++) {
    const block = updatedBlocks[i]
    if (block.type === 'image' || block.type === 'faq' || !block.content_html || block.status === 'pending') continue

    // Find position in content-only blocks
    const contentIdx = contentBlocksOnly.indexOf(block)
    if (contentIdx < lastThirdStart) continue

    // Check if block is over-long (> 350 words in last third)
    const wordCount = block.word_count || countWords(block.content_html)
    if (wordCount <= 350) continue

    // This block is in the last third AND too long — flag for condensation
    condensedCount++
  }

  // If we have blocks to condense, use AI to shorten them
  if (condensedCount > 0 && persona) {
    try {
      const blocksToCondense = updatedBlocks
        .map((b, i) => ({ ...b, originalIndex: i }))
        .filter((b) => {
          if (b.type === 'image' || b.type === 'faq' || !b.content_html || b.status === 'pending') return false
          const contentIdx = contentBlocksOnly.indexOf(b as ContentBlock)
          if (contentIdx < lastThirdStart) return false
          const wc = b.word_count || countWords(b.content_html)
          return wc > 350
        })

      if (blocksToCondense.length > 0) {
        const condensePrompt = `Tu es un expert en redaction SEO. Condense les blocs suivants d'un article sur "${article.keyword}".

Ces blocs sont dans le DERNIER TIERS de l'article. Le lecteur a deja eu la reponse principale. Il faut aller a l'essentiel.

## REGLES DE CONDENSATION
- Reduis chaque bloc a 200-300 mots maximum
- Garde UNIQUEMENT les informations essentielles et les points cles
- Supprime les phrases de contexte, les rappels, les developpements secondaires
- Prefere les listes a puces aux longs paragraphes
- Conserve TOUS les liens internes (<a href="...">) existants
- Conserve les tableaux et elements structures existants
- Garde le ton du persona "${persona.name}" (${persona.role})
- Retourne UNIQUEMENT un JSON valide : [{ "block_index": N, "new_content_html": "..." }, ...]

## BLOCS A CONDENSER
${blocksToCondense.map(b => `[Bloc ${b.originalIndex}] ${b.type} | "${b.heading || '(sans titre)'}" | ${b.word_count || countWords(b.content_html)} mots\n${b.content_html}`).join('\n\n---\n\n')}`

        const condenseResponse = await routeAI('optimize_blocks', [
          { role: 'user', content: condensePrompt },
        ])

        const condenseFixes = extractJSON<{ block_index: number; new_content_html: string }[]>(condenseResponse.content)
        if (Array.isArray(condenseFixes)) {
          for (const fix of condenseFixes) {
            if (fix.block_index >= 0 && fix.block_index < updatedBlocks.length && fix.new_content_html) {
              updatedBlocks[fix.block_index] = {
                ...updatedBlocks[fix.block_index],
                content_html: fix.new_content_html,
                word_count: countWords(fix.new_content_html),
              }
            }
          }
          console.log(`[seo-audit] ${condenseFixes.length} blocs du dernier tiers condenses`)
        }
      }
    } catch (err) {
      console.warn('[seo-audit] Block condensation failed, skipping:', err)
    }
  }

  // 5e. SEO Audit — sub-step E: auto-optimize blocks if critique score < 90
  let optimizationResult: {
    performed: boolean
    scoreBefore: number
    scoreAfter: number
    blocksOptimized: number
    details: { blockIndex: number; reason: string }[]
  } | null = null

  if (critiqueResult && critiqueResult.score < 90 && persona) {
    try {
      console.log(`[seo-audit] Score ${critiqueResult.score}/100 < 90 — lancement auto-optimisation…`)

      // Build blocks with index for the prompt
      const blocksForOptimize = updatedBlocks
        .map((b, i) => ({
          index: i,
          type: b.type,
          heading: b.heading || null,
          content_html: b.content_html || '',
          word_count: b.word_count || 0,
        }))
        .filter((b) => b.content_html && b.type !== 'image')

      const optimizePrompts = buildOptimizeBlocksPrompt({
        keyword: article.keyword,
        searchIntent: article.search_intent || undefined,
        articleTitle: article.title || article.keyword,
        persona: {
          name: persona.name,
          role: persona.role,
          tone_description: persona.tone_description,
          bio: persona.bio,
        },
        blocks: blocksForOptimize,
        issues: critiqueResult.issues,
        suggestions: critiqueResult.suggestions,
        scores: {
          score: critiqueResult.score,
          eeat_score: critiqueResult.eeat_score,
          readability: critiqueResult.readability,
          seo_score: critiqueResult.seo_score,
        },
      })

      const optimizeResponse = await routeAI('optimize_blocks', [
        { role: 'user', content: optimizePrompts.user },
      ], optimizePrompts.system)

      const fixes = extractJSON<{ optimized_blocks: { block_index: number; reason: string; new_content_html: string }[] }>(optimizeResponse.content)

      if (fixes && Array.isArray(fixes.optimized_blocks) && fixes.optimized_blocks.length > 0) {
        // Apply fixes to blocks
        for (const fix of fixes.optimized_blocks) {
          if (fix.block_index >= 0 && fix.block_index < updatedBlocks.length && fix.new_content_html) {
            updatedBlocks[fix.block_index] = {
              ...updatedBlocks[fix.block_index],
              content_html: fix.new_content_html,
              word_count: countWords(fix.new_content_html),
            }
          }
        }

        console.log(`[seo-audit] ${fixes.optimized_blocks.length} blocs optimises, re-run critique…`)

        // Re-run critique ONCE to get updated score
        try {
          const reFullContentHtml = updatedBlocks
            .filter((b) => b.content_html && b.status !== 'pending')
            .map((b) => {
              if (b.heading) return `<${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'p'}>${b.heading}</${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'p'}>\n${b.content_html}`
              return b.content_html
            })
            .join('\n')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<!--\s*wp:spacer[\s\S]*?-->/gi, '')
            .replace(/<div[^>]*style="height:\d+px"[^>]*><\/div>/gi, '')
            .replace(/<figure[^>]*class="[^"]*section-image[^"]*"[^>]*>[\s\S]*?<\/figure>/gi, '')

          const reCritiquePrompts = buildCritiquePrompt({
            keyword: article.keyword,
            searchIntent: article.search_intent || undefined,
            title: article.title || article.keyword,
            contentHtml: reFullContentHtml,
            persona: {
              name: persona.name,
              role: persona.role,
              tone_description: persona.tone_description,
              bio: persona.bio,
            },
          })

          const reCritiqueResponse = await routeAI('critique', [
            { role: 'user', content: reCritiquePrompts.user },
          ], reCritiquePrompts.system)

          const newCritique = validateCritiqueResult(
            extractJSON<Record<string, unknown>>(reCritiqueResponse.content)
          )

          optimizationResult = {
            performed: true,
            scoreBefore: critiqueResult.score,
            scoreAfter: newCritique.score,
            blocksOptimized: fixes.optimized_blocks.length,
            details: fixes.optimized_blocks.map((f) => ({ blockIndex: f.block_index, reason: f.reason })),
          }

          console.log(`[seo-audit] Auto-optimisation terminee : ${critiqueResult.score} → ${newCritique.score}`)

          // Use new critique scores for the audit
          critiqueResult = newCritique
        } catch (reErr) {
          console.warn('[seo-audit] Re-critique after optimization failed:', reErr)
          // Still record that optimization was performed
          optimizationResult = {
            performed: true,
            scoreBefore: critiqueResult.score,
            scoreAfter: critiqueResult.score, // unknown — re-critique failed
            blocksOptimized: fixes.optimized_blocks.length,
            details: fixes.optimized_blocks.map((f) => ({ blockIndex: f.block_index, reason: f.reason })),
          }
        }
      }
    } catch (err) {
      console.warn('[seo-audit] Auto-optimization failed:', err)
    }
  }

  // Build seo_audit object
  const seoAudit = {
    auditedAt: new Date().toISOString(),
    headings: {
      issues: headingIssues,
      corrections: headingCorrections.map((c) => ({ before: c.before, after: c.after })),
    },
    keywordDensity: {
      keyword: keywordDensityResult.keyword,
      count: keywordDensityResult.count,
      density: keywordDensityResult.density,
      status: keywordDensityResult.status,
    },
    keywordInIntro,
    ...(critiqueResult ? { critique: critiqueResult } : {}),
    ...(optimizationResult ? { optimization: optimizationResult } : {}),
    ...(personaConsistency ? { personaConsistency } : {}),
    ...(condensedCount > 0 ? { condensation: { blocksCondensed: condensedCount, reason: 'Blocs du dernier tiers trop longs (>350 mots)' } } : {}),
  }

  // 6. Update article
  const existingSerpData = (article.serp_data || {}) as Record<string, unknown>
  const updatePayload: Record<string, unknown> = {
    json_ld: jsonLd,
    content_blocks: updatedBlocks,
    nugget_density_score: nuggetDensity,
    serp_data: { ...existingSerpData, seo_audit: seoAudit },
  }
  if (metaRegenerated) {
    updatePayload.meta_description = metaDesc
  }

  await supabase
    .from('seo_articles')
    .update(updatePayload)
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      schemasGenerated: schemas.length,
      linksInjected,
      metaDescription: { length: metaDescLength, ok: metaDescOk, regenerated: metaRegenerated },
      nuggetDensity: Math.round(nuggetDensity * 100),
      seoAudit: {
        headingIssues: headingIssues.length,
        headingCorrections: headingCorrections.length,
        keywordDensity: keywordDensityResult.density,
        keywordInIntro,
        critiqueScore: critiqueResult?.score ?? null,
        optimization: optimizationResult ? {
          scoreBefore: optimizationResult.scoreBefore,
          scoreAfter: optimizationResult.scoreAfter,
          blocksOptimized: optimizationResult.blocksOptimized,
        } : null,
        personaConsistency: personaConsistency ? {
          score: personaConsistency.score,
          driftsCount: personaConsistency.drifts.length,
        } : null,
      },
    },
  }
}

// ---- Table inline styles for WordPress ----

/**
 * CSS bloc injecte une seule fois dans le HTML publie.
 * Gere le zebra-striping, hover et responsive (impossible en inline pur).
 */
const WP_FAQ_CSS = `<style>
.faq-section{display:flex;flex-direction:column;gap:12px;max-width:800px;margin:0 auto}
.faq-item{border-radius:12px;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden;transition:box-shadow .3s ease,border-color .3s ease}
.faq-item:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);border-color:#cbd5e1}
.faq-item[open]{box-shadow:0 6px 24px rgba(0,0,0,.1);border-color:#6366f1;border-left:3px solid #6366f1}
.faq-item summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.15rem 1.4rem;font-weight:600;font-size:1rem;line-height:1.5;cursor:pointer;list-style:none;background:#fff;color:#1e293b;transition:background .2s ease,color .2s ease;user-select:none}
.faq-item summary:hover{background:linear-gradient(135deg,#f8fafc,#f1f5f9);color:#0f172a}
.faq-item[open] summary{background:linear-gradient(135deg,#eef2ff,#e0e7ff);color:#3730a3}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::marker{display:none;content:''}
.faq-item summary::after{content:'';display:flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;border-radius:50%;background:#f1f5f9;border:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:center;transition:transform .35s cubic-bezier(.34,1.56,.64,1),background-color .2s ease;flex-shrink:0}
.faq-item summary:hover::after{background-color:#e2e8f0}
.faq-item[open] summary::after{transform:rotate(180deg);background-color:#c7d2fe;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234338ca' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")}
.faq-answer{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s cubic-bezier(.4,0,.2,1),opacity .25s ease;opacity:0}
.faq-item[open] .faq-answer{grid-template-rows:1fr;opacity:1;border-top:1px solid #e2e8f0}
.faq-answer>div{overflow:hidden}
.faq-answer>div>p,.faq-answer>div>div>p{padding:1rem 1.4rem 1.25rem;font-size:.95rem;line-height:1.8;color:#475569;margin:0}
.faq-answer>div>p+p,.faq-answer>div>div>p+p{padding-top:0;margin-top:-.25rem}
@media(max-width:640px){.faq-section{gap:8px}.faq-item{border-radius:8px}.faq-item summary{padding:.9rem 1rem;font-size:.925rem}.faq-item summary::after{width:24px;height:24px;min-width:24px}.faq-answer>div>p,.faq-answer>div>div>p{padding:.8rem 1rem 1rem;font-size:.9rem}}
</style>`

const WP_TABLE_CSS = `<style>
.seo-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:20px 0;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,.05)}
.seo-table-wrap table{width:100%;border-collapse:collapse;min-width:600px;font-size:.95rem;line-height:1.5}
.seo-table-wrap th{padding:14px 16px;font-weight:600;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap}
.seo-table-wrap td{padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}
.seo-table-wrap tbody tr:nth-child(even){background:#f8fafc}
.seo-table-wrap tbody tr:hover{background:#f1f5f9;transition:background-color .15s ease}
.seo-table-wrap tbody tr:last-child td{border-bottom:none}
@media(max-width:640px){.seo-table-wrap table{font-size:.85rem}.seo-table-wrap th,.seo-table-wrap td{padding:10px 12px}}
</style>`

/**
 * Replace .table-container / bare <table> with inline-styled wrapper for WordPress.
 * Uses theme_color from the site config for header background if available.
 */
function inlineTableStyles(html: string, themeColor: string | null): string {
  const headerBg = themeColor || '#1e293b'
  const headerStyle = `style="background:${headerBg};color:#fff;padding:14px 16px;font-weight:600;text-align:left;border:none;white-space:nowrap"`

  // Replace <div class="table-container"> wrappers with .seo-table-wrap
  let result = html.replace(
    /<div\s+class="table-container">\s*(<table[\s\S]*?<\/table>)\s*<\/div>/g,
    (_match, tableHtml: string) => {
      const styled = applyThStyles(tableHtml, headerStyle)
      return `<div class="seo-table-wrap">${styled}</div>`
    }
  )

  // Also catch bare <table> not already wrapped
  result = result.replace(
    /(?<!<div class="seo-table-wrap">)\s*(<table(?!\s*class="seo-)[\s\S]*?<\/table>)/g,
    (_match, tableHtml: string) => {
      const styled = applyThStyles(tableHtml, headerStyle)
      return `<div class="seo-table-wrap">${styled}</div>`
    }
  )

  return result
}

/** Apply inline style to all <th> tags inside a table HTML string */
function applyThStyles(tableHtml: string, thStyle: string): string {
  return tableHtml.replace(/<th(?:\s[^>]*)?>/g, `<th ${thStyle}>`)
}

/**
 * Strip Elementor wrapper divs from assembled HTML.
 * Kept blocks from imported WP articles may contain Elementor markup like:
 *   <div class="elementor-element ..."><div class="elementor-widget-container">...content...</div></div>
 * These wrappers break layout when Elementor edit mode is disabled.
 */
function stripElementorFromHtml(html: string): string {
  let cleaned = html

  // 1. Replace Elementor button widgets with clean styled CTA buttons
  cleaned = cleaned.replace(
    /<div[^>]*class="[^"]*elementor-widget-button[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?<span class="elementor-button-text">([\s\S]*?)<\/span>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi,
    (_m: string, url: string, text: string) =>
      `<div style="text-align:center;margin:30px 0"><a href="${url}" style="display:inline-block;padding:14px 32px;background-color:#335cd8;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;font-size:1.05rem">${text.trim()}</a></div>`
  )

  // 2. Remove Elementor divider widgets
  cleaned = cleaned.replace(
    /<div[^>]*class="[^"]*elementor-widget-divider[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, ''
  )

  // 3. Remove opening Elementor wrapper divs
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-(?:element|widget-wrap|section-wrap|container)[^"]*"[^>]*>\s*/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-widget-container[^"]*"[^>]*>\s*/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*e-con-inner[^"]*"[^>]*>\s*/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*e-con[^"]*"[^>]*>\s*/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor[^"]*"[^>]*>/gi, '')

  // 4. Remove Elementor data attributes
  cleaned = cleaned.replace(/\s*data-(?:id|element_type|e-type|widget_type|settings)="[^"]*"/gi, '')

  // 5. Remove empty divs
  cleaned = cleaned.replace(/<div[^>]*>\s*<\/div>\s*/g, '')

  // 6. Balance div tags — remove orphan </div> with no matching opening tag
  let output = ''
  let i = 0
  let divStack = 0
  while (i < cleaned.length) {
    if (cleaned.slice(i, i + 4) === '<div') {
      const end = cleaned.indexOf('>', i)
      if (end !== -1) {
        output += cleaned.slice(i, end + 1)
        divStack++
        i = end + 1
        continue
      }
    }
    if (cleaned.slice(i, i + 6) === '</div>') {
      if (divStack > 0) {
        output += '</div>'
        divStack--
      }
      i += 6
      continue
    }
    output += cleaned[i]
    i++
  }

  return output.replace(/\n{3,}/g, '\n\n').replace(/\t+/g, '').trim()
}

// ---- Publish step ----

async function executePublish(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const site = article.seo_sites

  // 1. Assemble full HTML from content blocks with spacing between sections
  // Use simple CSS margin instead of Gutenberg spacer blocks — spacer blocks render
  // full-width on Elementor themes and break the blog layout
  const SECTION_SPACER = '<div style="margin-top:50px" aria-hidden="true"></div>'

  const htmlParts: string[] = []
  let isFirstBlock = true
  for (const block of contentBlocks) {
    if (!block.content_html) continue
    if (block.heading && (block.type === 'h2' || block.type === 'h3' || block.type === 'h4')) {
      const tag = block.type
      // Add spacer before each heading section (not before the very first block)
      if (!isFirstBlock) {
        htmlParts.push(SECTION_SPACER)
      }
      htmlParts.push(`<${tag}>${block.heading}</${tag}>`)
    }
    htmlParts.push(block.content_html)
    isFirstBlock = false
  }

  // Inject JSON-LD script tag at the end
  const jsonLd = article.json_ld as Record<string, unknown> | null
  if (jsonLd) {
    htmlParts.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`)
  }

  // Apply table styles for WordPress (inline + CSS block)
  let fullHtml = htmlParts.join('\n\n')

  // Strip Elementor wrapper markup from kept blocks (imported WP articles retain old markup)
  if (fullHtml.includes('elementor')) {
    fullHtml = stripElementorFromHtml(fullHtml)
  }

  // Remove any stale Gutenberg spacer blocks — they render full-width on some themes
  fullHtml = fullHtml
    .replace(/<!--\s*wp:spacer[\s\S]*?<!--\s*\/wp:spacer\s*-->/gi, '')
    .replace(/<div[^>]*class="wp-block-spacer"[^>]*><\/div>/gi, '')
    .replace(/<div style="height:\d+px"[^>]*aria-hidden="true"[^>]*><\/div>/gi, '')

  if (fullHtml.includes('<table')) {
    fullHtml = WP_TABLE_CSS + '\n' + inlineTableStyles(fullHtml, site?.theme_color || null)
  }

  // Inject FAQ accordion CSS for WordPress
  if (fullHtml.includes('faq-section') || fullHtml.includes('faq-item')) {
    fullHtml = WP_FAQ_CSS + '\n' + fullHtml
  }

  // 2. Extract intro as excerpt (first paragraph block without heading)
  const introBlock = contentBlocks.find(b => b.type === 'paragraph' && !b.heading && b.content_html)
  const excerpt = introBlock
    ? introBlock.content_html.replace(/<[^>]*>/g, '').trim()
    : (article.meta_description || '')

  // 3. Fetch previous pipeline run to get hero media ID
  const { data: mediaRun } = await supabase
    .from('seo_pipeline_runs')
    .select('output')
    .eq('article_id', article.id)
    .eq('step', 'media')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const heroMediaId = (mediaRun?.output as Record<string, unknown>)?.heroMediaId as number | undefined

  // 4. Find best matching WP category (NEVER create new ones)
  let categoryIds: number[] | undefined
  try {
    // Try matching by niche first, then by keyword
    const searchTerms = [site?.niche, article.keyword].filter(Boolean) as string[]
    for (const term of searchTerms) {
      const catId = await findBestCategory(article.site_id, term)
      if (catId) {
        categoryIds = [catId]
        break
      }
    }
  } catch {
    // Category assignment is optional — continue without it
  }

  // 4b. Find or create WP tags from keyword + niche
  let tagIds: number[] | undefined
  try {
    const tagNames = [article.keyword]
    if (site?.niche) tagNames.push(site.niche)
    // Extract individual meaningful words from keyword for additional tags
    const kwWords = article.keyword.split(/\s+/).filter(w => w.length >= 5)
    if (kwWords.length >= 2) tagNames.push(...kwWords.slice(0, 2))
    tagIds = await findOrCreateTags(article.site_id, Array.from(new Set(tagNames)))
    if (tagIds.length === 0) tagIds = undefined
  } catch {
    // Tag assignment is optional
  }

  // 5. Build SEO meta for Yoast/Rank Math + Elementor cleanup
  const seoMeta: Record<string, unknown> = {}
  if (article.seo_title) {
    seoMeta._yoast_wpseo_title = article.seo_title
    seoMeta.rank_math_title = article.seo_title
  }
  if (article.meta_description) {
    seoMeta._yoast_wpseo_metadesc = article.meta_description
    seoMeta.rank_math_description = article.meta_description
  }
  if (article.keyword) {
    seoMeta._yoast_wpseo_focuskw = article.keyword
    seoMeta.rank_math_focus_keyword = article.keyword
  }
  // Disable Elementor edit mode on existing posts so WP renders post_content
  // instead of _elementor_data (which may contain old/stale Elementor content)
  if (article.wp_post_id) {
    seoMeta._elementor_edit_mode = ''
    seoMeta._elementor_data = '[]'
    seoMeta._wp_page_template = 'default'
  }
  const hasSeoMeta = Object.keys(seoMeta).length > 0

  // 6. Create or update WordPress post as DRAFT
  let wpPostId: number
  let wpUrl: string

  if (article.wp_post_id) {
    // Update existing post
    const wpPost = await updatePost(article.site_id, article.wp_post_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || undefined,
      status: 'publish',
      excerpt,
      featured_media: heroMediaId,
      categories: categoryIds,
      tags: tagIds,
      ...(hasSeoMeta ? { meta: seoMeta } : {}),
    })
    wpPostId = wpPost.id
    wpUrl = wpPost.link
  } else {
    // Create new post — publish directly
    const result = await createPost(article.site_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || article.keyword.toLowerCase().replace(/\s+/g, '-'),
      status: 'publish',
      excerpt,
      featured_media: heroMediaId,
      categories: categoryIds,
      tags: tagIds,
      ...(hasSeoMeta ? { meta: seoMeta } : {}),
    })
    wpPostId = result.wpPostId
    wpUrl = result.wpUrl
  }

  // 7. Update article with WP data
  const now = new Date().toISOString()
  await supabase
    .from('seo_articles')
    .update({
      wp_post_id: wpPostId,
      wp_url: wpUrl,
      content_html: fullHtml,
      published_at: article.published_at || now,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      wpPostId,
      wpUrl,
      htmlLength: fullHtml.length,
      status: 'publish',
      excerpt: excerpt.slice(0, 100) + '...',
      category: site?.niche || null,
      seoMeta: hasSeoMeta ? Object.keys(seoMeta) : [],
    },
  }
}

// ---- Refresh step ----

async function executeRefresh(
  article: ArticleWithRelations,
  input?: Record<string, unknown>,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const persona = article.seo_personas
  const existingSerpData = (article.serp_data || {}) as Record<string, unknown>

  // 1. Re-analyze SERP to check for changes
  let serpUpdate = null
  try {
    const newSerpData = await analyzeSERP(article.keyword)
    const newInsights = extractCompetitorInsights(newSerpData)
    serpUpdate = { serp: newSerpData, insights: newInsights }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('non configure')) throw error
  }

  // 2. Update year_tag to current year
  const currentYear = new Date().getFullYear()

  // 3. Run SEO audit (heading checks + keyword density + critique)
  let critiqueResult = null
  try {
    const fullContentHtml = contentBlocks
      .filter((b) => b.content_html && b.status !== 'pending')
      .map((b) => {
        if (b.heading) return `<${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : 'p'}>${b.heading}</${b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : 'p'}>\n${b.content_html}`
        return b.content_html
      })
      .join('\n')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--\s*wp:spacer[\s\S]*?-->/gi, '')

    if (fullContentHtml.length > 500 && persona) {
      const critiquePrompts = buildCritiquePrompt({
        keyword: article.keyword,
        searchIntent: article.search_intent || undefined,
        title: article.title || article.keyword,
        contentHtml: fullContentHtml,
        persona: {
          name: persona.name,
          role: persona.role,
          tone_description: persona.tone_description,
          bio: persona.bio,
        },
      })
      const critiqueResponse = await routeAI('critique', [
        { role: 'user', content: critiquePrompts.user },
      ], critiquePrompts.system)
      const parsed = extractJSON<Record<string, unknown>>(critiqueResponse.content)
      if (parsed) {
        critiqueResult = validateCritiqueResult(parsed)
      }
    }
  } catch (err) {
    console.warn('[refresh] Critique failed, skipping:', err)
  }

  // 4. Keyword density analysis
  const keywordDensity = analyzeKeywordDensity(
    contentBlocks.filter(b => b.content_html).map(b => b.content_html).join(' '),
    article.keyword,
  )

  // 5. Detect stale headings (outdated year references)
  const staleBlocks: number[] = []
  const yearRegex = /\b(202[0-5])\b/g
  contentBlocks.forEach((block, idx) => {
    if (!block.content_html) return
    const matches = block.content_html.match(yearRegex)
    if (matches && !matches.includes(String(currentYear))) {
      staleBlocks.push(idx)
    }
  })

  // 6. Auto-correct outdated years in content
  const updatedBlocks = contentBlocks.map((block, idx) => {
    if (!staleBlocks.includes(idx) || !block.content_html) return block
    const updatedHtml = block.content_html.replace(/\b(202[0-5])\b/g, String(currentYear))
    return { ...block, content_html: updatedHtml }
  })

  // 7. Update dateModified in JSON-LD
  const existingJsonLd = article.json_ld as Record<string, unknown> | null
  if (existingJsonLd) {
    const now = new Date().toISOString()
    if (Array.isArray(existingJsonLd['@graph'])) {
      for (const item of existingJsonLd['@graph'] as Record<string, unknown>[]) {
        if (item['@type'] === 'Article') item.dateModified = now
      }
    } else if (existingJsonLd['@type'] === 'Article') {
      existingJsonLd.dateModified = now
    }
  }

  // 9. Suggest nuggets for injection
  let suggestedNuggets: { id: string; content: string; tags: string[] }[] = []
  try {
    const { data: nuggets } = await supabase
      .from('seo_nuggets')
      .select('id, content, tags')
      .eq('site_id', article.site_id)
      .limit(10)
    if (nuggets && nuggets.length > 0) {
      const keywordLower = article.keyword.toLowerCase()
      suggestedNuggets = nuggets
        .filter((n) => {
          const text = `${n.content} ${(n.tags || []).join(' ')}`.toLowerCase()
          return keywordLower.split(' ').some((w: string) => w.length > 3 && text.includes(w))
        })
        .slice(0, 5)
        .map(n => ({ id: n.id, content: n.content, tags: n.tags || [] }))
    }
  } catch {
    // non-blocking
  }

  // 10. Build refresh audit
  const refreshAudit = {
    refreshedAt: new Date().toISOString(),
    previousYearTag: article.year_tag,
    newYearTag: currentYear,
    serpUpdated: !!serpUpdate,
    staleBlocksUpdated: staleBlocks.length,
    critique: critiqueResult,
    keywordDensity,
    suggestedNuggets,
  }

  // 11. Save all updates
  const mergedSerpData = {
    ...existingSerpData,
    ...(serpUpdate || {}),
    refresh_audit: refreshAudit,
  }

  const updatePayload: Record<string, unknown> = {
    serp_data: mergedSerpData,
    year_tag: currentYear,
    content_blocks: updatedBlocks,
  }
  if (existingJsonLd) {
    updatePayload.json_ld = existingJsonLd
  }

  await supabase
    .from('seo_articles')
    .update(updatePayload)
    .eq('id', article.id)

  // 12. Optional: push updated content to WordPress
  let wpPushed = false
  if (input?.pushToWp && article.wp_post_id) {
    try {
      const assembledHtml = updatedBlocks
        .map((b: ContentBlock) => {
          if (b.heading) {
            const tag = b.type === 'h2' ? 'h2' : b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'
            return `<${tag}>${b.heading}</${tag}>\n${b.content_html || ''}`
          }
          return b.content_html || ''
        })
        .join('\n\n')

      await updatePost(article.site_id, article.wp_post_id, { content: assembledHtml })
      wpPushed = true
    } catch (wpErr) {
      console.warn('[refresh] WP push failed:', wpErr)
    }
  }

  return {
    success: true,
    runId: '',
    output: {
      serpUpdated: !!serpUpdate,
      yearUpdated: currentYear,
      staleBlocksFixed: staleBlocks.length,
      critiqueScore: critiqueResult?.score || null,
      wpPushed,
      suggestedNuggetsCount: suggestedNuggets.length,
      message: `Refresh termine : ${staleBlocks.length} bloc(s) mis a jour, annee ${currentYear}.${wpPushed ? ' Pousse vers WP.' : ''}`,
    },
  }
}

// ---- Helpers ----

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').length : 0
}

function estimateCost(tokensIn: number, tokensOut: number, model: string): number {
  // Approximate pricing per 1M tokens
  if (model.includes('claude')) {
    return (tokensIn * 3 + tokensOut * 15) / 1_000_000
  }
  if (model.includes('gemini')) {
    return (tokensIn * 0.075 + tokensOut * 0.3) / 1_000_000
  }
  if (model.includes('gpt')) {
    if (model.includes('mini')) {
      return (tokensIn * 0.15 + tokensOut * 0.6) / 1_000_000
    }
    return (tokensIn * 2.5 + tokensOut * 10) / 1_000_000
  }
  return 0
}

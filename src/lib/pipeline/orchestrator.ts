import { getServerClient } from '@/lib/supabase/client'
import type { Article, ArticleStatus, ContentBlock, AuthorityLinkSuggestion, SelectedAuthorityLink } from '@/lib/supabase/types'
import type { PipelineStep, PipelineContext, PipelineRunResult } from './types'

// Article with joined relations from Supabase query
type ArticleWithRelations = Article & {
  seo_personas: { name: string; role: string; tone_description: string | null; bio: string | null; avatar_reference_url: string | null; writing_style_examples: Record<string, unknown>[]; banned_phrases?: string[]; familiar_expressions?: string[] } | null
  seo_sites: { name: string; domain: string; niche: string | null; theme_color: string | null; money_page_url: string | null; money_page_description: string | null } | null
}
import { validateTransition, getNextStatus } from './state-machine'
import { analyzeSERP, extractCompetitorInsights } from '@/lib/seo/serper'
import { checkCannibalization } from '@/lib/seo/anti-cannibal'
import { analyzeCompetitorContent, buildCompetitorAnalysisPrompt } from '@/lib/seo/competitor-scraper'
import type { CompetitorContentAnalysis } from '@/lib/seo/competitor-scraper'
import { routeAI, routeAIWithOverrides, modelIdToOverride, estimateCost as estimateResponseCost } from '@/lib/ai/router'
import type { ModelConfig } from '@/lib/ai/types'
import { buildPlanArchitectPrompt } from '@/lib/ai/prompts/plan-architect'
import { buildBlockWriterPrompt } from '@/lib/ai/prompts/block-writer'
import { generateImage, buildImagePrompt, generateHeroImage, ContentPolicyError } from '@/lib/media/fal-ai'
import { optimizeForWeb } from '@/lib/media/sharp-processor'
import { generateSeoFilename, generateAltText, generateImageTitle } from '@/lib/media/seo-rename'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema, generateHowToSchema, generateReviewSchema, assembleJsonLd } from '@/lib/seo/json-ld'
import { generateInternalLinks, injectLinksIntoHtml } from '@/lib/seo/internal-links'
import { createPost, updatePost, uploadMedia, findBestCategory, findOrCreateTags, getAllPublishedPosts } from '@/lib/wordpress/client'
import { analyzeKeywordDensity } from '@/lib/seo/keyword-analysis'
import { buildCritiquePrompt, validateCritiqueResult } from '@/lib/ai/prompts/critique'
import { buildOptimizeBlocksPrompt } from '@/lib/ai/prompts/optimize-blocks'
import { checkNuggetIntegration, type NuggetCheckDetail, type NuggetIntegrationResult } from './quality-checks'
import { convertHtmlToGutenbergBlocks } from './gutenberg'
import { checkBrokenLinks, type LinkCheckSummary } from '@/lib/seo/link-checker'
import { findBacklinkCandidates, generateBacklinkSuggestion, type BacklinkSuggestion, type SiloArticleInfo } from '@/lib/seo/reverse-backlinks'
import { analyzeReadability, type ReadabilityResult } from '@/lib/seo/readability'
import {
  analyzeSemanticCoverage,
  generateMissingTermSuggestions,
  validateEntityCoverage,
  tokenizeArticleContent,
  detectSemanticCannibalization,
  buildEntityExtractionPrompt,
  type SemanticCoverageResult,
  type EntityExtractionResult,
  type SemanticCannibalizationResult,
  type MissingTermSuggestion,
  type ExtractedEntity,
} from '@/lib/seo/semantic-analysis'
import { detectOverusedPhrases } from '@/lib/seo/phrase-dedup'
import { analyzeBurstiness, extractUsedConnectors, type BurstinessResult } from '@/lib/seo/burstiness'
import { fetchTemporalContext } from '@/lib/seo/serper'

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

  // Check for common non-JSON responses (safety blocks, error messages)
  if (/^(Blocked|Bad Request|Error|I cannot|I'm sorry|Je ne peux)/i.test(raw.trim())) {
    throw new Error(`La reponse IA a ete bloquee ou est invalide. Debut : ${raw.substring(0, 200)}`)
  }
  throw new Error(`JSON invalide dans la reponse IA. Debut : ${raw.substring(0, 300)}`)
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
        result = await executeMedia(article as ArticleWithRelations, input)
        break
      case 'seo':
        result = await executeSeo(article as ArticleWithRelations)
        break
      case 'publish':
        result = await executePublish(article as ArticleWithRelations)
        break
      case 'publish_gds':
        result = await executeGdsPublish(article as ArticleWithRelations)
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
        // Fetch nuggets to include in semantic analysis
        let nuggetsSummary: string[] = []
        try {
          const { data: siteNuggets } = await supabase
            .from('seo_nuggets')
            .select('content, tags')
            .or(`site_ids.cs.{${article.site_id}},site_id.eq.${article.site_id},site_id.is.null`)
            .limit(20)
          if (siteNuggets && siteNuggets.length > 0) {
            nuggetsSummary = siteNuggets.map(n => {
              const tags = (n.tags || []).join(', ')
              const content = (n.content || '').slice(0, 150)
              return tags ? `[${tags}] ${content}` : content
            })
          }
        } catch {
          // Nuggets fetch failed — continue without them
        }

        try {
          const prompt = buildCompetitorAnalysisPrompt(article.keyword, competitorContent, nuggetsSummary.length > 0 ? nuggetsSummary : undefined)
          const aiResponse = await routeAI(
            'analyze_competitor_content',
            [{ role: 'user', content: prompt }]
          )
          competitorTokensIn = aiResponse.tokensIn
          competitorTokensOut = aiResponse.tokensOut
          competitorModel = aiResponse.model
          competitorCostUsd = estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model, aiResponse.thinkingTokens)

          semanticAnalysis = extractJSON(aiResponse.content)
        } catch {
          // Gemini analysis failed — continue without it
        }

        // 2b. NLP Entity extraction from competitor content
        try {
          const competitorTexts = competitorContent.pages
            .filter(p => p.scrapeSuccess && p.markdown)
            .map(p => p.markdown!)
          if (competitorTexts.length > 0) {
            const entityPrompt = buildEntityExtractionPrompt(article.keyword, competitorTexts)
            const entityResponse = await routeAI(
              'analyze_competitor_content',
              [{ role: 'user', content: entityPrompt }]
            )
            competitorTokensIn += entityResponse.tokensIn
            competitorTokensOut += entityResponse.tokensOut
            competitorCostUsd += estimateCost(entityResponse.tokensIn, entityResponse.tokensOut, entityResponse.model, entityResponse.thinkingTokens)

            const entityResult = extractJSON<{ entities: ExtractedEntity[] }>(entityResponse.content)
            if (entityResult?.entities && Array.isArray(entityResult.entities)) {
              if (!semanticAnalysis) semanticAnalysis = {}
              ;(semanticAnalysis as Record<string, unknown>).entities = entityResult.entities
              console.log(`[analyze] Extracted ${entityResult.entities.length} NLP entities from competitors`)
            }
          }
        } catch {
          // Entity extraction failed — continue without it
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

  // Fetch nuggets for this site, ranked by keyword relevance + recency
  const { data: rawNuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags, source_type, created_at')
    .or(`site_ids.cs.{${article.site_id}},site_id.eq.${article.site_id},site_id.is.null`)
    .limit(50)

  // Score nuggets by keyword relevance + recency boost and take top 20
  const kwWords = article.keyword.toLowerCase().split(/\s+/)
  const nuggetRefYear = new Date().getFullYear()
  const nuggets = (rawNuggets || [])
    .map(n => {
      const content = (n.content || '').toLowerCase()
      const tags = (n.tags || []).map((t: string) => t.toLowerCase())
      const tagScore = kwWords.filter(w => tags.some((t: string) => t.includes(w))).length * 3
      const contentScore = kwWords.filter(w => content.includes(w)).length
      // Recency boost: nuggets from current year get +5, last year +2
      const nuggetYear = n.created_at ? new Date(n.created_at).getFullYear() : 0
      const recencyBoost = nuggetYear === nuggetRefYear ? 5 : nuggetYear === nuggetRefYear - 1 ? 2 : 0
      return { ...n, _relevance: tagScore + contentScore + recencyBoost }
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

  // Fetch product comparison data if intent is "comparison"
  let productComparison: Parameters<typeof buildPlanArchitectPrompt>[0]['productComparison'] = undefined
  if (article.search_intent === 'comparison') {
    const serpObj = serpDataRaw as Record<string, unknown> | null
    if (serpObj?.productComparison) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      productComparison = serpObj.productComparison as any
    }
  }

  // Build editorial context
  const siteEditorialAngle = (article.seo_sites as Record<string, unknown>)?.editorial_angle as Record<string, string> | null
  const editorialContext = {
    siteEditorialAngle: siteEditorialAngle ? {
      site_description: siteEditorialAngle.site_description || '',
      tone: siteEditorialAngle.tone || '',
      unique_selling_point: siteEditorialAngle.unique_selling_point || '',
      content_approach: siteEditorialAngle.content_approach || '',
      target_audience: siteEditorialAngle.target_audience || '',
    } : undefined,
    articleAngle: (article as Record<string, unknown>).article_angle as string | undefined,
    writingDirectives: ((article as Record<string, unknown>).writing_directives as { label: string; checked: boolean }[] | null)?.filter(d => d.checked),
  }

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
    productComparison,
    editorialContext,
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
    costUsd: estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model, aiResponse.thinkingTokens),
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
    // Fallback: fetch site nuggets and rank by keyword relevance + recency
    const { data: allNuggets } = await supabase
      .from('seo_nuggets')
      .select('id, content, tags, created_at')
      .or(`site_ids.cs.{${article.site_id}},site_id.eq.${article.site_id},site_id.is.null`)
      .limit(50)

    if (allNuggets && allNuggets.length > 0) {
      const keywordWords = article.keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const headingWords = (block.heading || '').toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const fallbackCurrentYear = new Date().getFullYear()

      // Score each nugget by tag + content overlap with keyword/heading + recency
      // Keyword words get higher weight (5 pts) vs heading words (2 pts)
      const scored = (allNuggets as { id: string; content: string; tags: string[]; created_at?: string }[])
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
          // Recency boost: recent nuggets have fresher data (stats, facts)
          const nYear = n.created_at ? new Date(n.created_at).getFullYear() : 0
          if (nYear === fallbackCurrentYear) score += 5
          else if (nYear === fallbackCurrentYear - 1) score += 2
          return { ...n, score }
        })

      // Higher threshold (>=6) to avoid weak matches, max 2 nuggets in fallback mode
      matchedNuggets = scored
        .filter(n => n.score >= 6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ score: _s, created_at: _c, ...n }) => n)
    }
  }

  // Override with mandatory nuggets if provided (from auto-rewrite in SEO step)
  if (input?.mandatoryNuggets) {
    matchedNuggets = input.mandatoryNuggets as { id: string; content: string; tags: string[] }[]
  }

  // Override writing directive if provided (for mandatory nugget rewrite)
  const effectiveDirective = (input?.mandatoryDirective as string) || block.writing_directive

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null; avatar_reference_url: string | null; writing_style_examples: Record<string, unknown>[] } | null
  const previousHeadings = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.heading)
    .map((b: ContentBlock) => b.heading!)

  // Extract internal link targets from the block (set by the plan)
  // Enrich money page links with the actual description from site settings
  const rawLinkTargets = block.internal_link_targets || []
  const moneyPageDesc = article.seo_sites?.money_page_description || ''
  const internalLinkTargets = rawLinkTargets.map((lt) => {
    if (lt.is_money_page && moneyPageDesc) {
      return { ...lt, money_page_description: moneyPageDesc } as typeof lt & { money_page_description: string }
    }
    return lt
  })
  const siteDomain = article.seo_sites?.domain

  // Authority link injection: any block AFTER the first H2 (never in intro or first H2)
  const selectedAuth = article.selected_authority_link as SelectedAuthorityLink | null
  const alreadyPlaced = contentBlocks
    .slice(0, blockIndex)
    .some(b => b.content_html?.includes(selectedAuth?.url || '___'))
  const h2CountBefore = contentBlocks
    .slice(0, blockIndex)
    .filter(b => b.type === 'h2').length
  const isAfterFirstH2 = h2CountBefore >= 1 || (block.type === 'h2' && h2CountBefore >= 1)
  const shouldInjectAuth = selectedAuth && !alreadyPlaced && isAfterFirstH2 && block.type !== 'faq'

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
  // Increased from 500 to 800 chars per block for better anti-repetition coverage
  let articleDigest: string | undefined
  const writtenBefore = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.content_html && (b.status === 'written' || b.status === 'approved'))
  if (writtenBefore.length >= 1) {
    const digestParts = writtenBefore.map((b: ContentBlock) => {
      const plain = (b.content_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const summary = plain.slice(0, 800) + (plain.length > 800 ? '...' : '')
      return `- [${b.heading || 'Intro'}] ${summary}`
    })
    articleDigest = digestParts.join('\n')
  }

  // Build editorial context for block writing
  const siteEA = (article.seo_sites as Record<string, unknown>)?.editorial_angle as Record<string, string> | null
  const blockEditorialContext = {
    siteEditorialAngle: siteEA ? {
      tone: siteEA.tone || '',
      unique_selling_point: siteEA.unique_selling_point || '',
      content_approach: siteEA.content_approach || '',
    } : undefined,
    articleAngle: (article as Record<string, unknown>).article_angle as string | undefined,
    writingDirectives: undefined as string[] | undefined,
  }
  // Extract writing directives relevant to this block from the block's writing_directive
  // The plan-architect assigns directives to blocks via writing_directive text

  // --- Banned phrases: manual (persona config) + auto-detected cross-article tics ---
  let bannedPhrases: string[] = []
  // 1. Manual banned phrases from persona settings
  if (persona?.banned_phrases && persona.banned_phrases.length > 0) {
    bannedPhrases = [...persona.banned_phrases]
  }
  // 2. Auto-detected overused phrases (passed from write-all or computed on first block)
  const cachedTics = (input?.detectedTics as string[]) || null
  if (cachedTics) {
    bannedPhrases = [...bannedPhrases, ...cachedTics.filter(t => !bannedPhrases.includes(t))]
  } else if (blockIndex === 0 && article.persona_id) {
    // First block: detect cross-article tics and they'll be passed to subsequent blocks
    try {
      const overused = await detectOverusedPhrases(article.persona_id, article.id)
      const autoTics = overused.map(o => o.phrase)
      bannedPhrases = [...bannedPhrases, ...autoTics.filter(t => !bannedPhrases.includes(t))]
    } catch (e) {
      console.warn('[orchestrator] Failed to detect overused phrases:', e)
    }
  }

  const prompt = buildBlockWriterPrompt({
    keyword: article.keyword,
    searchIntent: article.search_intent,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null, avatar_reference_url: null, writing_style_examples: [] },
    block: {
      type: block.type,
      heading: block.heading ?? null,
      word_count: block.word_count,
      writing_directive: effectiveDirective,
      format_hint: block.format_hint,
    },
    nuggets: matchedNuggets.map(n => ({
      id: n.id, content: n.content, tags: n.tags,
      context: block.nugget_context?.[n.id] || undefined,
    })),
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
    productComparison: (() => {
      if (article.search_intent !== 'comparison') return undefined
      const sd = article.serp_data as Record<string, unknown> | null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return sd?.productComparison as any
    })(),
    editorialContext: blockEditorialContext,
    bannedPhrases: bannedPhrases.length > 0 ? bannedPhrases : undefined,
    saturatedConnectors: (() => {
      // Extract connectors already overused in previous blocks
      const saturated = (input?.saturatedConnectors as string[]) || extractUsedConnectors(contentBlocks.slice(0, blockIndex))
      return saturated.length > 0 ? saturated : undefined
    })(),
    temporalContext: (input?.temporalContext as string) || undefined,
    familiarExpressions: persona?.familiar_expressions && persona.familiar_expressions.length > 0
      ? persona.familiar_expressions
      : undefined,
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

  // Post-process: remove "Persona Name - Role" line from expert callouts (not wanted in final output)
  if (processedHtml.includes('expert-callout')) {
    processedHtml = processedHtml.replace(
      /<p\s+style="[^"]*font-size:0\.92rem[^"]*font-weight:600[^"]*">[^<]*<\/p>\s*/g,
      ''
    )
  }

  // Post-process: enforce max 3 callouts per article — strip excess callouts
  if (processedHtml.includes('expert-callout')) {
    // Count existing callouts in previously written blocks
    let existingCallouts = 0
    for (let ci = 0; ci < blockIndex; ci++) {
      const cb = contentBlocks[ci]
      if (cb.content_html && (cb.status === 'written' || cb.status === 'approved')) {
        const cm = cb.content_html.match(/class="expert-callout"/g)
        if (cm) existingCallouts += cm.length
      }
    }
    // Count callouts in this block
    const thisBlockCallouts = (processedHtml.match(/class="expert-callout"/g) || []).length
    if (existingCallouts + thisBlockCallouts > 3) {
      // Remove excess callouts from this block (keep only what fits within limit)
      const allowed = Math.max(0, 3 - existingCallouts)
      if (allowed === 0) {
        // Remove ALL callouts from this block
        processedHtml = processedHtml.replace(
          /<div\s+class="expert-callout"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g,
          ''
        )
      }
    }
  }

  // Repair any truncated HTML tags before saving
  processedHtml = repairTruncatedHtml(processedHtml)

  const wordCount = countWords(processedHtml)

  // skipSave mode: return result without DB write (for batch/parallel writing)
  if (input?.skipSave) {
    return {
      success: true,
      runId: '',
      output: {
        blockIndex,
        blockType: block.type,
        wordCount,
        processedHtml,
        nuggetIdsUsed: matchedNuggets.map(n => n.id),
      },
      tokensIn: aiResponse.tokensIn,
      tokensOut: aiResponse.tokensOut,
      costUsd: estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model, aiResponse.thinkingTokens),
      modelUsed: aiResponse.model,
    }
  }

  // Update the specific block
  const updatedBlocks = [...contentBlocks]
  updatedBlocks[blockIndex] = {
    ...block,
    content_html: processedHtml,
    status: 'written' as const,
    model_used: aiResponse.model,
    word_count: wordCount,
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
      wordCount,
      writtenBlocks: writtenCount,
      totalBlocks: updatedBlocks.length,
      nuggetIdsUsed: matchedNuggets.map(n => n.id),
    },
    tokensIn: aiResponse.tokensIn,
    tokensOut: aiResponse.tokensOut,
    costUsd: estimateCost(aiResponse.tokensIn, aiResponse.tokensOut, aiResponse.model, aiResponse.thinkingTokens),
    modelUsed: aiResponse.model,
  }
}

// ---- Media step ----

async function executeMedia(
  article: ArticleWithRelations,
  input?: Record<string, unknown>,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // If pre-generated images are provided (from parallel execution), use them directly
  const pregenImages = input?.preGeneratedImages as PreGeneratedImage[] | undefined
  if (pregenImages && pregenImages.length > 0) {
    return injectPreGeneratedImages(article, pregenImages)
  }

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
    // Content policy error (copyright) → skip ALL image generation, keep existing images
    if (error instanceof ContentPolicyError) {
      console.warn(`[media] ${error.message} — skip image generation, conserve images existantes`)
      return {
        success: true,
        runId: '',
        output: {
          skipped: true,
          reason: error.message,
          heroMediaId: null,
          sectionImages: 0,
        }
      }
    }
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
  // If any image hits content policy (copyright), skip ALL remaining and return success
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

  // Check if any image hit content policy — if so, skip all and return success with warning
  const contentPolicyHit = imageResults.find(
    r => r.status === 'rejected' && r.reason instanceof ContentPolicyError
  )
  if (contentPolicyHit) {
    const reason = (contentPolicyHit as PromiseRejectedResult).reason as ContentPolicyError
    console.warn(`[media] ${reason.message} — skip section images, conserve images existantes`)
    // Still save blocks and transition status
    await supabase
      .from('seo_articles')
      .update({ content_blocks: updatedBlocks })
      .eq('id', article.id)
    return {
      success: true,
      runId: '',
      output: {
        skipped: true,
        reason: reason.message,
        heroMediaId: heroMediaId || null,
        sectionImages: 0,
      }
    }
  }

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

    // First section image gets fetchpriority="high" (above-the-fold LCP), rest get loading="lazy"
    const isFirstImg = uploadedImages.length === 0
    const imgLoadAttr = isFirstImg ? 'fetchpriority="high"' : 'loading="lazy"'

    if (isImageBlock) {
      updatedBlocks[blockIndex] = {
        ...block,
        content_html: `<figure><img src="${wpMedia.url}" alt="${altText}" title="${imgTitle}" width="${optimized.width}" height="${optimized.height}" ${imgLoadAttr} />${block.heading ? `<figcaption>${block.heading}</figcaption>` : ''}</figure>`,
        status: 'written' as const,
      }
    } else {
      const imageHtml = `<figure class="section-image"><img src="${wpMedia.url}" alt="${altText}" title="${imgTitle}" width="${optimized.width}" height="${optimized.height}" ${imgLoadAttr} /></figure>`
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

// ---- Pre-generate images (for parallel execution with writing) ----

export interface PreGeneratedImage {
  blockIndex: number
  isImageBlock: boolean
  wpUrl: string
  mediaId: number
  altText: string
  imgTitle: string
  width: number
  height: number
  heading: string | null
  heroMediaId?: number
}

/**
 * Pre-generate all article images (hero + sections) without touching content_blocks.
 * Returns image data that can later be injected via executeMedia({ preGeneratedImages }).
 * This allows image generation to run concurrently with block writing.
 */
export async function preGenerateArticleImages(articleId: string): Promise<PreGeneratedImage[]> {
  const supabase = getServerClient()
  const { data: article } = await supabase
    .from('seo_articles')
    .select('id, keyword, title, site_id, content_blocks')
    .eq('id', articleId)
    .single()

  if (!article) return []

  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const results: PreGeneratedImage[] = []

  // 1. Generate hero image
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

    // Save hero image URL immediately (doesn't conflict with writing)
    await supabase
      .from('seo_articles')
      .update({ hero_image_url: wpMedia.url })
      .eq('id', article.id)

    results.push({
      blockIndex: -1, // special: hero image
      isImageBlock: false,
      wpUrl: wpMedia.url,
      mediaId: wpMedia.mediaId,
      altText,
      imgTitle: `${article.title || article.keyword} - Image principale`,
      width: optimized.width,
      height: optimized.height,
      heading: null,
      heroMediaId: wpMedia.mediaId,
    })
  } catch (error) {
    if (error instanceof ContentPolicyError) {
      console.warn(`[media-pregen] ${error.message} — skip all images`)
      return []
    }
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('non configure') && !msg.includes('FAL_KEY')) {
      console.warn('[media-pregen] Hero image failed:', msg)
    }
  }

  // 2. Determine which blocks need images (same logic as executeMedia)
  const MIN_SECTION_IMAGES = 5
  const MAX_IMAGES = 8
  const heroGenerated = results.length > 0
  const maxSectionImages = MAX_IMAGES - (heroGenerated ? 1 : 0)

  const updatedBlocks = [...contentBlocks]

  // Force image on first H2
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

  // Ensure minimum section images
  function hasContentImage(html: string): boolean {
    if (!html) return false
    const withoutAvatars = html.replace(/<img[^>]*border-radius:\s*50%[^>]*>/gi, '')
    return withoutAvatars.includes('<img')
  }

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

  // Collect candidates
  const candidates: number[] = []
  for (let i = 0; i < updatedBlocks.length; i++) {
    const block = updatedBlocks[i]
    const isImageBlock = block.type === 'image' && !hasContentImage(block.content_html || '')
    const isH2WithImage = (block.type === 'h2' || block.type === 'h3') && block.generate_image === true && !hasContentImage(block.content_html || '')
    if (isImageBlock || isH2WithImage) candidates.push(i)
  }

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

  // 3. Generate section images in parallel
  const selectedList = Array.from(selectedIndices)
  const imageResults = await Promise.allSettled(
    selectedList.map(async (blockIdx, s) => {
      const block = updatedBlocks[blockIdx]
      const isImageBlock = block.type === 'image' && !hasContentImage(block.content_html || '')

      // Section context for image prompt (from plan, not from written content)
      let sectionContent = block.content_html || ''
      if (block.type === 'h2') {
        for (let j = blockIdx + 1; j < updatedBlocks.length; j++) {
          if (updatedBlocks[j].type === 'h2') break
          if (updatedBlocks[j].content_html) sectionContent += ' ' + updatedBlocks[j].content_html
        }
      }

      const prompt = buildImagePrompt(article.keyword, block.heading || '', sectionContent, block.image_prompt_hint, article.title || article.keyword)
      const imageResult = await generateImage(prompt, { aspectRatio: "16:9" })
      const imgBuffer = await fetch(imageResult.url).then(r => r.arrayBuffer())
      const optimized = await optimizeForWeb(Buffer.from(imgBuffer))
      const filename = generateSeoFilename(article.keyword, block.heading || null, 'section')
      const altText = generateAltText(article.keyword, block.heading || null, 'section', block.image_prompt_hint, s)
      const imgTitle = generateImageTitle(article.keyword, block.heading || null, 'section')

      const wpMedia = await uploadMedia(article.site_id, {
        buffer: optimized.buffer,
        filename,
        altText,
        title: imgTitle,
        caption: altText,
      })

      return {
        blockIndex: blockIdx,
        isImageBlock,
        wpUrl: wpMedia.url,
        mediaId: wpMedia.mediaId,
        altText,
        imgTitle,
        width: optimized.width,
        height: optimized.height,
        heading: block.heading || null,
      } as PreGeneratedImage
    })
  )

  // Check content policy hit
  const policyHit = imageResults.find(r => r.status === 'rejected' && r.reason instanceof ContentPolicyError)
  if (policyHit) {
    console.warn(`[media-pregen] Content policy hit — returning hero only`)
    return results // just hero if generated
  }

  for (const r of imageResults) {
    if (r.status === 'fulfilled') results.push(r.value)
  }

  return results
}

/**
 * Inject pre-generated images into content_blocks (after writing is complete).
 */
async function injectPreGeneratedImages(
  article: ArticleWithRelations,
  images: PreGeneratedImage[],
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // Re-read fresh content_blocks (writing may have updated them)
  const { data: freshArticle } = await supabase
    .from('seo_articles')
    .select('content_blocks')
    .eq('id', article.id)
    .single()

  const contentBlocks = [...((freshArticle?.content_blocks || article.content_blocks || []) as ContentBlock[])]
  const uploadedImages: { blockIndex: number; url: string; mediaId: number }[] = []
  let heroMediaId: number | undefined

  for (const img of images) {
    if (img.blockIndex === -1) {
      // Hero image — already saved hero_image_url during pre-generation
      heroMediaId = img.heroMediaId
      continue
    }

    const block = contentBlocks[img.blockIndex]
    if (!block) continue

    // First section image gets fetchpriority="high" (above-the-fold), rest get loading="lazy"
    const isFirstSectionImage = uploadedImages.length === 0
    const loadingAttr = isFirstSectionImage ? 'fetchpriority="high"' : 'loading="lazy"'

    if (img.isImageBlock) {
      contentBlocks[img.blockIndex] = {
        ...block,
        content_html: `<figure><img src="${img.wpUrl}" alt="${img.altText}" title="${img.imgTitle}" width="${img.width}" height="${img.height}" ${loadingAttr} />${img.heading ? `<figcaption>${img.heading}</figcaption>` : ''}</figure>`,
        status: 'written' as const,
      }
    } else {
      const imageHtml = `<figure class="section-image"><img src="${img.wpUrl}" alt="${img.altText}" title="${img.imgTitle}" width="${img.width}" height="${img.height}" ${loadingAttr} /></figure>`
      contentBlocks[img.blockIndex] = {
        ...block,
        content_html: imageHtml + (block.content_html || ''),
      }
    }

    uploadedImages.push({ blockIndex: img.blockIndex, url: img.wpUrl, mediaId: img.mediaId })
  }

  // Save updated blocks
  await supabase
    .from('seo_articles')
    .update({ content_blocks: contentBlocks })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      heroMediaId,
      imagesGenerated: uploadedImages.length,
      uploadedImages,
      preGenerated: true,
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

  // Identify intro block index — intro is PROTECTED from all SEO auto-modifications
  // (the user may have manually edited it)
  const introBlockIndex = updatedBlocks.findIndex(
    (b) => b.type === 'paragraph' && !b.heading && b.content_html
  )

  // Pre-scan: extract slugs already linked by the AI during write-step
  const existingLinkSlugs = new Set<string>()
  const hrefRegex = /<a\s[^>]*href=["']([^"']+)["']/gi
  const allWrittenHtml = updatedBlocks.filter(b => b.content_html).map(b => b.content_html).join(' ')
  // Normalize domain: strip protocol and trailing slash for URL construction
  const rawDomain = site?.domain || ''
  const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const siteBaseUrl = cleanDomain ? `https://${cleanDomain}` : ''
  let hrefMatch: RegExpExecArray | null
  while ((hrefMatch = hrefRegex.exec(allWrittenHtml)) !== null) {
    try {
      const url = new URL(hrefMatch[1], siteBaseUrl || 'https://example.com')
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
          url: `${siteBaseUrl}/${l.targetSlug}`,
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
          url: post.link || `${siteBaseUrl}/${post.slug}`,
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

  // 4b. Verify nugget integration — check assigned nuggets are actually in written text
  let nuggetIntegration: NuggetIntegrationResult | null = null
  const allNuggetIds = contentBlocks
    .flatMap(b => b.nugget_ids || [])
    .filter((id, i, arr) => arr.indexOf(id) === i) // dedupe

  if (allNuggetIds.length > 0) {
    const { data: nuggets } = await supabase
      .from('seo_nuggets')
      .select('id, content')
      .in('id', allNuggetIds)

    if (nuggets && nuggets.length > 0) {
      const nuggetMap = new Map(nuggets.map(n => [n.id, n.content]))
      const details: NuggetCheckDetail[] = []

      for (let bi = 0; bi < contentBlocks.length; bi++) {
        const block = contentBlocks[bi]
        const blockNuggetIds = block.nugget_ids || []
        if (blockNuggetIds.length === 0 || !block.content_html) continue

        for (const nid of blockNuggetIds) {
          const nuggetContent = nuggetMap.get(nid)
          if (!nuggetContent) continue

          const { integrated, matchScore } = checkNuggetIntegration(block.content_html, nuggetContent)
          details.push({
            blockIndex: bi,
            heading: block.heading || null,
            nuggetId: nid,
            status: integrated ? 'integrated' : 'ignored',
            matchScore,
          })
        }
      }

      const totalAssigned = details.length
      const totalIntegrated = details.filter(d => d.status === 'integrated').length
      const totalIgnored = totalAssigned - totalIntegrated

      nuggetIntegration = {
        totalAssigned,
        totalIntegrated,
        totalIgnored,
        integrationRate: totalAssigned > 0 ? Math.round((totalIntegrated / totalAssigned) * 100) : 100,
        details,
      }

      console.log(`[seo] Nugget integration: ${totalIntegrated}/${totalAssigned} integrated (${nuggetIntegration.integrationRate}%), ${totalIgnored} ignored`)

      // 4c. Auto-rewrite blocks with ignored nuggets (max 3 blocks)
      if (totalIgnored > 0 && nuggetIntegration.integrationRate < 80) {
        const ignoredByBlock = new Map<number, string[]>()
        for (const d of details) {
          if (d.status === 'ignored') {
            const arr = ignoredByBlock.get(d.blockIndex) || []
            arr.push(d.nuggetId)
            ignoredByBlock.set(d.blockIndex, arr)
          }
        }

        let rewriteCount = 0
        const ignoredEntries = Array.from(ignoredByBlock.entries())
        for (const [bi, ignoredIds] of ignoredEntries) {
          if (rewriteCount >= 3) break
          const block = contentBlocks[bi]
          if (!block || block.status !== 'written') continue

          // Fetch the ignored nuggets content
          const { data: ignoredNuggets } = await supabase
            .from('seo_nuggets')
            .select('id, content, tags')
            .in('id', ignoredIds)

          if (!ignoredNuggets || ignoredNuggets.length === 0) continue

          console.log(`[seo] Re-writing block ${bi} "${block.heading}" with ${ignoredNuggets.length} mandatory nuggets`)

          // Append mandatory nugget directive to the existing writing_directive
          const mandatoryDirective = `${block.writing_directive || ''}\n\nATTENTION — NUGGETS OBLIGATOIRES : Les nuggets suivants DOIVENT etre integres dans cette section. Ils contiennent des donnees a jour et verifiees. Reformule-les et integre-les naturellement dans le texte existant.`

          try {
            const rewriteResult = await executeStep(article.id, 'write_block', {
              blockIndex: bi,
              usedNuggetIds: [],
              mandatoryNuggets: ignoredNuggets.map(n => ({ id: n.id, content: n.content, tags: n.tags || [] })),
              mandatoryDirective,
            })
            if (rewriteResult.success) {
              rewriteCount++
              // Re-check integration on rewritten block
              const { data: refreshedArticle } = await supabase
                .from('seo_articles')
                .select('content_blocks')
                .eq('id', article.id)
                .single()
              if (refreshedArticle?.content_blocks) {
                const refreshedBlocks = refreshedArticle.content_blocks as ContentBlock[]
                if (refreshedBlocks[bi]) {
                  contentBlocks[bi] = refreshedBlocks[bi]
                  updatedBlocks[bi] = refreshedBlocks[bi]
                }
              }
            }
          } catch (err) {
            console.error(`[seo] Failed to re-write block ${bi}:`, err)
          }
        }

        if (rewriteCount > 0) {
          console.log(`[seo] Re-wrote ${rewriteCount} blocks with mandatory nuggets`)
          // Update nugget integration stats after rewrites
          const newDetails: NuggetCheckDetail[] = []
          for (let bi2 = 0; bi2 < contentBlocks.length; bi2++) {
            const b2 = contentBlocks[bi2]
            const bNuggetIds = b2.nugget_ids || []
            if (bNuggetIds.length === 0 || !b2.content_html) continue
            for (const nid of bNuggetIds) {
              const nc = nuggetMap.get(nid)
              if (!nc) continue
              const { integrated, matchScore } = checkNuggetIntegration(b2.content_html, nc)
              newDetails.push({ blockIndex: bi2, heading: b2.heading || null, nuggetId: nid, status: integrated ? 'integrated' : 'ignored', matchScore })
            }
          }
          const newTotal = newDetails.length
          const newIntegrated = newDetails.filter(d => d.status === 'integrated').length
          nuggetIntegration = {
            totalAssigned: newTotal,
            totalIntegrated: newIntegrated,
            totalIgnored: newTotal - newIntegrated,
            integrationRate: newTotal > 0 ? Math.round((newIntegrated / newTotal) * 100) : 100,
            details: newDetails,
          }
          console.log(`[seo] Post-rewrite nugget integration: ${newIntegrated}/${newTotal} (${nuggetIntegration.integrationRate}%)`)
        }
      }
    }
  }

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

  // 5a-bis. SEO Audit — auto-split long H2 sections into H3 subsections
  // Detect H2 blocks with >400 words that have no H3 children, then use AI to split them
  let h2SplitCount = 0
  try {
    // Build a map of H2 index → next H2 index to find child blocks
    const h2Indices = updatedBlocks
      .map((b, i) => ({ index: i, type: b.type }))
      .filter(b => b.type === 'h2')
      .map(b => b.index)

    const longH2Blocks: { blockIndex: number; heading: string; wordCount: number; contentHtml: string }[] = []

    for (let hi = 0; hi < h2Indices.length; hi++) {
      const h2Idx = h2Indices[hi]
      const nextH2Idx = h2Indices[hi + 1] ?? updatedBlocks.length
      const block = updatedBlocks[h2Idx]

      // Skip intro-protected block
      if (h2Idx === introBlockIndex) continue
      if (!block.content_html || block.status === 'pending') continue

      // Check if this H2 already has H3 children
      const hasH3Children = updatedBlocks
        .slice(h2Idx + 1, nextH2Idx)
        .some(b => b.type === 'h3')

      if (hasH3Children) continue

      const wordCount = block.word_count || countWords(block.content_html)
      if (wordCount > 400) {
        longH2Blocks.push({
          blockIndex: h2Idx,
          heading: block.heading || '',
          wordCount,
          contentHtml: block.content_html,
        })
      }
    }

    if (longH2Blocks.length > 0 && persona) {
      console.log(`[seo-audit] ${longH2Blocks.length} section(s) H2 trop longue(s) sans H3 — split en cours...`)

      const splitPrompt = `Tu es un expert en architecture de contenu SEO.

## MISSION
Decoupe les sections H2 suivantes en sous-sections H3 semantiquement optimisees.

## MOT-CLE PRINCIPAL
"${article.keyword}"

## REGLES
- Chaque section H2 trop longue doit etre decoupee en 2-4 sous-sections H3
- Chaque H3 doit avoir un heading semantiquement riche (contient un terme du champ lexical de "${article.keyword}")
- Les H3 doivent etre MECE : mutuellement exclusifs, collectivement exhaustifs
- Le contenu HTML existant doit etre reparti dans les H3 (pas de perte de contenu)
- Garde le heading H2 original tel quel
- Le premier H3 recoit le debut du contenu, le deuxieme la suite, etc.
- Coupe aux frontieres naturelles : changement de sujet, nouveau paragraphe, nouvelle idee
- Chaque H3 doit avoir au moins 100 mots
- Conserve TOUS les liens, tableaux, listes, encarts existants sans modification
- Retourne UNIQUEMENT un JSON valide

## FORMAT DE REPONSE
[
  {
    "original_block_index": 3,
    "subsections": [
      { "h3_heading": "Heading H3 optimise SEO", "content_html": "<p>Contenu...</p>" },
      { "h3_heading": "Autre heading H3", "content_html": "<p>Suite...</p>" }
    ]
  }
]

## SECTIONS A DECOUPER
${longH2Blocks.map(b => `### [Bloc ${b.blockIndex}] H2 : "${b.heading}" (${b.wordCount} mots)
${b.contentHtml}`).join('\n\n---\n\n')}`

      const splitResponse = await routeAI('generate_title', [
        { role: 'user', content: splitPrompt },
      ])

      const splits = extractJSON<{ original_block_index: number; subsections: { h3_heading: string; content_html: string }[] }[]>(splitResponse.content)

      if (Array.isArray(splits)) {
        // Apply splits in reverse order to preserve indices
        const sortedSplits = [...splits].sort((a, b) => b.original_block_index - a.original_block_index)

        for (const split of sortedSplits) {
          const idx = split.original_block_index
          if (idx < 0 || idx >= updatedBlocks.length || !split.subsections || split.subsections.length < 2) continue

          const originalBlock = updatedBlocks[idx]

          // Build replacement blocks: keep H2 with first subsection content, then add H3 blocks
          const replacementBlocks: ContentBlock[] = []

          // First subsection goes into the original H2 block
          const firstSub = split.subsections[0]
          replacementBlocks.push({
            ...originalBlock,
            content_html: firstSub.content_html,
            word_count: countWords(firstSub.content_html),
          })

          // Remaining subsections become new H3 blocks
          for (let si = 1; si < split.subsections.length; si++) {
            const sub = split.subsections[si]
            replacementBlocks.push({
              id: `${originalBlock.id}-h3-${si}`,
              type: 'h3',
              heading: sub.h3_heading,
              content_html: sub.content_html,
              word_count: countWords(sub.content_html),
              status: 'written',
              nugget_ids: [],
              model_used: originalBlock.model_used,
            })
          }

          // Splice: replace original block with replacement blocks
          updatedBlocks.splice(idx, 1, ...replacementBlocks)
          h2SplitCount++

          console.log(`[seo-audit] H2 "${originalBlock.heading}" split en ${split.subsections.length} sous-sections`)
        }
      }
    }
  } catch (err) {
    console.warn('[seo-audit] H2 split failed, skipping:', err)
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

  // 5b-bis. Readability scoring (algorithmic)
  let readabilityResult: ReadabilityResult | null = null
  try {
    readabilityResult = analyzeReadability(updatedBlocks)
    console.log(`[seo-audit] Readability score: ${readabilityResult.score}/100 (avg sentence: ${readabilityResult.avgSentenceLength} words, visual density: ${readabilityResult.visualDensity})`)
  } catch (err) {
    console.warn('[seo-audit] Readability analysis failed:', err)
  }

  // 5b-quater. Burstiness scoring (AI detection fingerprint)
  let burstinessResult: BurstinessResult | null = null
  try {
    burstinessResult = analyzeBurstiness(updatedBlocks)
    console.log(`[seo-audit] Burstiness score: ${burstinessResult.score}/100 (stdDev: ${burstinessResult.sentenceLengthStdDev}, short ratio: ${burstinessResult.shortSentenceRatio}, overused connectors: ${burstinessResult.overusedConnectors.length})`)
  } catch (err) {
    console.warn('[seo-audit] Burstiness analysis failed:', err)
  }

  // 5b-ter. Pre-compute semantic coverage for use in critique (Axes 1, 3, 4)
  let earlySemanticMissing: string[] = []
  let earlyEntityMissing: string[] = []
  try {
    const existingSerpForSemantic = (article.serp_data || {}) as Record<string, unknown>
    const compData = existingSerpForSemantic.competitorContent as { tfidfKeywords?: { term: string; tfidf: number; df: number }[] } | undefined
    const semData = existingSerpForSemantic.semanticAnalysis as { semanticField?: string[]; entities?: ExtractedEntity[] } | undefined
    const tfidf = compData?.tfidfKeywords || []
    const semField = semData?.semanticField || []

    if (tfidf.length > 0 || semField.length > 0) {
      const earlyCoverage = analyzeSemanticCoverage(updatedBlocks, tfidf, semField)
      earlySemanticMissing = [...earlyCoverage.tfidfMissing.slice(0, 10), ...earlyCoverage.semanticMissing.slice(0, 5)]
    }
    if (semData?.entities && semData.entities.length > 0) {
      const earlyEntities = validateEntityCoverage(semData.entities, updatedBlocks)
      earlyEntityMissing = earlyEntities.entitiesMissing.slice(0, 10)
    }
  } catch {
    // Non-critical — continue without semantic data in critique
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
        missingSemanticTerms: earlySemanticMissing.length > 0 ? earlySemanticMissing : undefined,
        missingEntities: earlyEntityMissing.length > 0 ? earlyEntityMissing : undefined,
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

    // Check if block is over-long (> 250 words in last third)
    const wordCount = block.word_count || countWords(block.content_html)
    if (wordCount <= 250) continue

    // This block is in the last third AND too long — flag for condensation
    condensedCount++
  }

  // If we have blocks to condense, use AI to shorten them
  if (condensedCount > 0 && persona) {
    try {
      const blocksToCondense = updatedBlocks
        .map((b, i) => ({ ...b, originalIndex: i }))
        .filter((b) => {
          if (b.originalIndex === introBlockIndex) return false // Intro protected
          if (b.type === 'image' || b.type === 'faq' || !b.content_html || b.status === 'pending') return false
          const contentIdx = contentBlocksOnly.indexOf(b as ContentBlock)
          if (contentIdx < lastThirdStart) return false
          const wc = b.word_count || countWords(b.content_html)
          return wc > 250
        })

      if (blocksToCondense.length > 0) {
        const condensePrompt = `Tu es un expert en redaction SEO. Condense les blocs suivants d'un article sur "${article.keyword}".

Ces blocs sont dans le DERNIER TIERS de l'article. Le lecteur a deja eu la reponse principale. Il faut aller a l'essentiel.

## REGLES DE CONDENSATION
- Reduis chaque bloc a 150-250 mots maximum
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
            if (fix.block_index === introBlockIndex) continue // Intro protected
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
        .filter((b) => b.content_html && b.type !== 'image' && b.index !== introBlockIndex)

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
        // Apply fixes to blocks — SKIP intro block (protected from auto-modification)
        for (const fix of fixes.optimized_blocks) {
          if (fix.block_index === introBlockIndex) {
            console.log(`[seo-audit] Skipping intro block #${fix.block_index} — protected from auto-optimization`)
            continue
          }
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

  // 5f. SEO Audit — sub-step F: broken link verification
  let brokenLinksResult: LinkCheckSummary | null = null
  try {
    const blocksForLinkCheck = updatedBlocks
      .filter(b => b.content_html && b.status !== 'pending')
      .map(b => ({ content_html: b.content_html, type: b.type, status: b.status || 'written' }))
    const siteDomain = site?.domain || ''
    if (blocksForLinkCheck.length > 0 && siteDomain) {
      brokenLinksResult = await checkBrokenLinks(blocksForLinkCheck, siteDomain)
      if (brokenLinksResult.brokenLinks > 0) {
        console.warn(`[seo-audit] ${brokenLinksResult.brokenLinks} lien(s) casse(s) detecte(s) sur ${brokenLinksResult.totalLinks} verifies`)
      } else {
        console.log(`[seo-audit] ${brokenLinksResult.totalLinks} liens verifies, aucun casse`)
      }
    }
  } catch (err) {
    console.warn('[seo-audit] Broken link check failed, skipping:', err)
  }

  // 5g. SEO Audit — sub-step G: semantic coverage validation (Axes 1, 3, 4)
  let semanticCoverage: SemanticCoverageResult | null = null
  let missingTermSuggestions: MissingTermSuggestion[] = []
  let entityCoverage: EntityExtractionResult | null = null
  let semanticCannibalization: SemanticCannibalizationResult | null = null

  try {
    const existingSerpForSemantic = (article.serp_data || {}) as Record<string, unknown>
    const competitorData = existingSerpForSemantic.competitorContent as { tfidfKeywords?: { term: string; tfidf: number; df: number }[] } | undefined
    const semanticData = existingSerpForSemantic.semanticAnalysis as { semanticField?: string[]; entities?: ExtractedEntity[] } | undefined

    const tfidfKeywords = competitorData?.tfidfKeywords || []
    const semanticField = semanticData?.semanticField || []

    if (tfidfKeywords.length > 0 || semanticField.length > 0) {
      // Axe 1 + 3: Semantic coverage score
      semanticCoverage = analyzeSemanticCoverage(updatedBlocks, tfidfKeywords, semanticField)
      console.log(`[seo-audit] Semantic coverage: TF-IDF ${semanticCoverage.tfidfCoverage}%, Semantic Field ${semanticCoverage.semanticFieldCoverage}%, Global ${semanticCoverage.globalScore}%`)

      // Axe 4: Missing term suggestions
      if (semanticCoverage.tfidfMissing.length > 0 || semanticCoverage.semanticMissing.length > 0) {
        missingTermSuggestions = generateMissingTermSuggestions(semanticCoverage, tfidfKeywords, updatedBlocks)
        console.log(`[seo-audit] ${missingTermSuggestions.length} missing terms with injection suggestions`)
      }

      // Axe 2: Entity coverage validation
      const entities = semanticData?.entities
      if (entities && entities.length > 0) {
        entityCoverage = validateEntityCoverage(entities, updatedBlocks)
        console.log(`[seo-audit] Entity coverage: ${entityCoverage.entitiesPresent.length}/${entities.length} entities present (${entityCoverage.coverageScore}%)`)
      }

      // Axe 5: Semantic cannibalization check (same silo)
      if (article.silo_id) {
        try {
          const { data: siloArticles } = await supabase
            .from('seo_articles')
            .select('id, title, keyword, serp_data, content_blocks')
            .eq('silo_id', article.silo_id)
            .neq('id', article.id)
            .in('status', ['written', 'reviewing', 'published', 'refresh_needed'] as ArticleStatus[])
            .limit(20)

          if (siloArticles && siloArticles.length > 0) {
            const currentTerms = tokenizeArticleContent(updatedBlocks)
            semanticCannibalization = detectSemanticCannibalization(
              currentTerms,
              siloArticles.map(a => ({
                id: a.id,
                title: a.title,
                keyword: a.keyword,
                serp_data: a.serp_data as Record<string, unknown> | null,
                content_blocks: a.content_blocks as ContentBlock[] | null,
              })),
            )
            if (semanticCannibalization.hasConflict) {
              console.warn(`[seo-audit] Semantic cannibalization detected with ${semanticCannibalization.conflicts.length} article(s): ${semanticCannibalization.conflicts.map(c => `"${c.articleKeyword}" (${c.overlapScore}%)`).join(', ')}`)
            }
          }
        } catch (err) {
          console.warn('[seo-audit] Semantic cannibalization check failed:', err)
        }
      }
    }
  } catch (err) {
    console.warn('[seo-audit] Semantic coverage analysis failed:', err)
  }

  // 5h. SEO Audit — sub-step H: auto reverse backlinks (for published articles with WP)
  const reverseBacklinksResult: BacklinkSuggestion[] = []
  if (article.wp_post_id && article.wp_url && (article.status === 'published' || article.status === 'refresh_needed')) {
    try {
      console.log(`[seo-audit] Generating reverse backlink suggestions…`)

      // Fetch same-silo articles for priority scoring
      let siloArticles: SiloArticleInfo[] = []
      if (article.silo_id) {
        const { data: siloData } = await supabase
          .from('seo_articles')
          .select('keyword, title, slug, wp_post_id, silo_id')
          .eq('silo_id', article.silo_id)
          .neq('id', article.id)
          .in('status', ['published', 'refresh_needed'])
        if (siloData && siloData.length > 0) {
          siloArticles = siloData as SiloArticleInfo[]
          console.log(`[seo-audit] Found ${siloArticles.length} same-silo articles for priority scoring`)
        }
      }

      const candidates = await findBacklinkCandidates(
        article.site_id,
        article.keyword,
        article.title || article.keyword,
        article.wp_post_id,
        article.wp_url,
        siloArticles
      )

      if (candidates.length > 0) {
        for (const candidate of candidates) {
          const suggestion = await generateBacklinkSuggestion(
            { keyword: article.keyword, title: article.title || article.keyword, wpUrl: article.wp_url },
            candidate,
            article.site_id
          )
          if (suggestion) {
            reverseBacklinksResult.push(suggestion)
          }
        }
        console.log(`[seo-audit] ${reverseBacklinksResult.length} reverse backlink suggestion(s) generated`)
      } else {
        console.log(`[seo-audit] No backlink candidates found`)
      }
    } catch (err) {
      console.warn('[seo-audit] Reverse backlinks generation failed, skipping:', err)
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
    ...(burstinessResult ? {
      burstiness: {
        score: burstinessResult.score,
        sentenceLengthStdDev: burstinessResult.sentenceLengthStdDev,
        avgSentenceLength: burstinessResult.avgSentenceLength,
        shortSentenceRatio: burstinessResult.shortSentenceRatio,
        overusedConnectors: burstinessResult.overusedConnectors,
        issues: burstinessResult.issues,
      },
    } : {}),
    ...(readabilityResult ? {
      readability: {
        score: readabilityResult.score,
        avgSentenceLength: readabilityResult.avgSentenceLength,
        longSentenceRatio: readabilityResult.longSentenceRatio,
        avgParagraphLength: readabilityResult.avgParagraphLength,
        visualElements: readabilityResult.visualElements,
        visualDensity: readabilityResult.visualDensity,
        maxConsecutiveProse: readabilityResult.maxConsecutiveProse,
        issues: readabilityResult.issues,
      },
    } : {}),
    ...(critiqueResult ? { critique: critiqueResult } : {}),
    ...(optimizationResult ? { optimization: optimizationResult } : {}),
    ...(personaConsistency ? { personaConsistency } : {}),
    ...(h2SplitCount > 0 ? { h2Splits: { sectionsSplit: h2SplitCount, reason: 'Sections H2 >400 mots sans H3 — decoupees en sous-sections semantiques' } } : {}),
    ...(condensedCount > 0 ? { condensation: { blocksCondensed: condensedCount, reason: 'Blocs du dernier tiers trop longs (>350 mots)' } } : {}),
    ...(nuggetIntegration ? { nuggetIntegration } : {}),
    ...(brokenLinksResult ? { brokenLinks: brokenLinksResult } : {}),
    ...(semanticCoverage ? {
      semanticCoverage: {
        globalScore: semanticCoverage.globalScore,
        tfidfCoverage: semanticCoverage.tfidfCoverage,
        semanticFieldCoverage: semanticCoverage.semanticFieldCoverage,
        tfidfPresent: semanticCoverage.tfidfPresent,
        tfidfMissing: semanticCoverage.tfidfMissing,
        semanticPresent: semanticCoverage.semanticPresent,
        semanticMissing: semanticCoverage.semanticMissing,
      },
    } : {}),
    ...(missingTermSuggestions.length > 0 ? {
      missingTerms: missingTermSuggestions.map(s => ({
        term: s.term,
        importance: s.importance,
        suggestedBlockIndex: s.suggestedBlockIndex,
        reason: s.reason,
      })),
    } : {}),
    ...(entityCoverage ? {
      entityCoverage: {
        coverageScore: entityCoverage.coverageScore,
        entitiesPresent: entityCoverage.entitiesPresent,
        entitiesMissing: entityCoverage.entitiesMissing,
        totalEntities: entityCoverage.competitorEntities.length,
      },
    } : {}),
    ...(semanticCannibalization?.hasConflict ? {
      semanticCannibalization: {
        hasConflict: true,
        conflicts: semanticCannibalization.conflicts.map(c => ({
          articleId: c.articleId,
          articleTitle: c.articleTitle,
          articleKeyword: c.articleKeyword,
          overlapScore: c.overlapScore,
          sharedTerms: c.sharedTerms.slice(0, 10),
        })),
      },
    } : {}),
  }

  // 6. Update article
  const existingSerpData = (article.serp_data || {}) as Record<string, unknown>
  const updatePayload: Record<string, unknown> = {
    json_ld: jsonLd,
    content_blocks: updatedBlocks,
    nugget_density_score: nuggetDensity,
    serp_data: {
      ...existingSerpData,
      seo_audit: seoAudit,
      ...(reverseBacklinksResult.length > 0 ? { reverse_backlinks: reverseBacklinksResult } : {}),
    },
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
        h2Splits: h2SplitCount,
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
        nuggetIntegration: nuggetIntegration ? {
          totalAssigned: nuggetIntegration.totalAssigned,
          totalIntegrated: nuggetIntegration.totalIntegrated,
          totalIgnored: nuggetIntegration.totalIgnored,
          integrationRate: nuggetIntegration.integrationRate,
        } : null,
        brokenLinks: brokenLinksResult ? {
          total: brokenLinksResult.totalLinks,
          broken: brokenLinksResult.brokenLinks,
          ok: brokenLinksResult.okLinks,
        } : null,
        readability: readabilityResult ? {
          score: readabilityResult.score,
          avgSentenceLength: readabilityResult.avgSentenceLength,
          issuesCount: readabilityResult.issues.length,
        } : null,
        burstiness: burstinessResult ? {
          score: burstinessResult.score,
          stdDev: burstinessResult.sentenceLengthStdDev,
          overusedConnectors: burstinessResult.overusedConnectors.length,
          issuesCount: burstinessResult.issues.length,
        } : null,
        semanticCoverage: semanticCoverage ? {
          globalScore: semanticCoverage.globalScore,
          tfidfCoverage: semanticCoverage.tfidfCoverage,
          semanticFieldCoverage: semanticCoverage.semanticFieldCoverage,
          missingTermsCount: missingTermSuggestions.length,
          highPriorityMissing: missingTermSuggestions.filter(s => s.importance === 'high').length,
        } : null,
        entityCoverage: entityCoverage ? {
          coverageScore: entityCoverage.coverageScore,
          present: entityCoverage.entitiesPresent.length,
          missing: entityCoverage.entitiesMissing.length,
        } : null,
        semanticCannibalization: semanticCannibalization?.hasConflict ? {
          conflictCount: semanticCannibalization.conflicts.length,
          topConflict: semanticCannibalization.conflicts[0] ? {
            keyword: semanticCannibalization.conflicts[0].articleKeyword,
            overlap: semanticCannibalization.conflicts[0].overlapScore,
          } : null,
        } : null,
        reverseBacklinks: reverseBacklinksResult.length > 0 ? {
          count: reverseBacklinksResult.length,
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
.mhd-faq-wrapper{max-width:850px;margin:40px auto;font-family:'Inter',system-ui,-apple-system,sans-serif;padding:0 20px}
.mhd-faq-title{color:#1e293b;text-align:center;font-size:2rem;font-weight:800;margin-bottom:35px;letter-spacing:-0.02em}
.mhd-faq-item{background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:15px;overflow:hidden;transition:all 0.3s ease}
.mhd-faq-item:hover{border-color:#10b981;box-shadow:0 4px 12px rgba(16,185,129,0.08)}
.mhd-faq-item[open]{border-color:#10b981;box-shadow:0 10px 20px -5px rgba(0,0,0,0.05)}
.mhd-faq-item summary{padding:22px 28px;list-style:none;cursor:pointer;font-weight:700;font-size:1.1rem;color:#0f172a;display:flex;justify-content:space-between;align-items:center;outline:none}
.mhd-faq-item summary::-webkit-details-marker{display:none}
.mhd-faq-item summary::after{content:'';width:20px;height:20px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2310b981' stroke-width='3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E") no-repeat center;transition:transform 0.4s cubic-bezier(0.4,0,0.2,1)}
.mhd-faq-item[open] summary::after{transform:rotate(180deg)}
.mhd-faq-content{padding:0 28px 25px 28px;line-height:1.7;font-size:1rem;color:#475569;border-top:1px solid #f1f5f9;animation:mhdFadeIn 0.4s ease-out}
.mhd-faq-content p{margin:15px 0 0 0}
.mhd-faq-content strong{color:#064e3b}
@keyframes mhdFadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:640px){.mhd-faq-item summary{font-size:1rem;padding:18px 22px}.mhd-faq-title{font-size:1.6rem}}
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
 * Convert raw HTML to Gutenberg block comments so each element is editable in WP editor.
 * Splits content into: paragraphs, lists, tables, figures, blockquotes, custom HTML.
 */
// convertHtmlToGutenbergBlocks and splitHtmlTopLevel moved to ./gutenberg.ts

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

  // 1. Assemble full HTML as Gutenberg blocks for WordPress
  //    Each content block becomes editable individually in the WP editor
  const gutenbergParts: string[] = []
  let needsTableCss = false
  let needsFaqCss = false

  let isFirstBlock = true
  for (const block of contentBlocks) {
    if (!block.content_html) continue

    // Add spacer before each heading section (not before the very first block)
    if (block.heading && (block.type === 'h2' || block.type === 'h3' || block.type === 'h4') && !isFirstBlock) {
      gutenbergParts.push(`<!-- wp:spacer {"height":"50px"} -->\n<div style="height:50px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`)
    }

    // Render heading as Gutenberg heading block
    if (block.heading && (block.type === 'h2' || block.type === 'h3' || block.type === 'h4')) {
      const level = block.type === 'h2' ? 2 : block.type === 'h3' ? 3 : 4
      gutenbergParts.push(`<!-- wp:heading {"level":${level}} -->\n<${block.type}>${block.heading}</${block.type}>\n<!-- /wp:heading -->`)
    }

    // Convert block content_html to Gutenberg blocks
    let blockHtml = block.content_html

    // Apply table inline styles if needed
    if (blockHtml.includes('<table')) {
      blockHtml = inlineTableStyles(blockHtml, site?.theme_color || null)
      needsTableCss = true
    }

    // Track FAQ CSS need
    if (blockHtml.includes('mhd-faq-wrapper') || blockHtml.includes('mhd-faq-item') || blockHtml.includes('faq-section') || blockHtml.includes('faq-item')) {
      needsFaqCss = true
    }

    gutenbergParts.push(convertHtmlToGutenbergBlocks(blockHtml))
    isFirstBlock = false
  }

  // Inject JSON-LD as custom HTML block at the end
  const jsonLd = article.json_ld as Record<string, unknown> | null
  if (jsonLd) {
    gutenbergParts.push(`<!-- wp:html -->\n<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n<!-- /wp:html -->`)
  }

  // Prepend CSS as a single <style> block
  let fullHtml = gutenbergParts.join('\n\n')
  const cssBlocks: string[] = []
  if (needsTableCss) {
    const tableRules = WP_TABLE_CSS.replace(/<\/?style>/g, '').trim()
    cssBlocks.push(tableRules)
  }
  if (needsFaqCss) {
    const faqRules = WP_FAQ_CSS.replace(/<\/?style>/g, '').trim()
    cssBlocks.push(faqRules)
  }
  if (cssBlocks.length > 0) {
    const mergedCss = `<style>\n${cssBlocks.join('\n')}\n</style>`
    fullHtml = `<!-- wp:html -->\n${mergedCss}\n<!-- /wp:html -->\n\n` + fullHtml
  }

  // Strip Elementor wrapper markup from kept blocks (imported WP articles retain old markup)
  if (fullHtml.includes('elementor')) {
    fullHtml = stripElementorFromHtml(fullHtml)
  }

  // Repair any truncated HTML tables/tags before publishing
  fullHtml = repairTruncatedHtml(fullHtml)

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

  // 5. Build SEO meta for Yoast/Rank Math + Open Graph + Elementor cleanup
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

  // Open Graph + Twitter Cards meta
  const ogTitle = article.seo_title || article.title || article.keyword
  const ogDescription = article.meta_description || ''
  const heroImageUrl = (article as Record<string, unknown>).hero_image_url as string | undefined
  const siteDomainClean = site?.domain?.replace(/^https?:\/\//, '').replace(/\/+$/, '') || ''
  const articleUrl = article.wp_url || (article.slug ? `https://${siteDomainClean}/${article.slug}` : '')

  // Yoast OG fields
  seoMeta._yoast_wpseo_opengraph_title = ogTitle
  seoMeta._yoast_wpseo_opengraph_description = ogDescription
  if (heroImageUrl) {
    seoMeta._yoast_wpseo_opengraph_image = heroImageUrl
  }
  // Yoast Twitter fields
  seoMeta._yoast_wpseo_twitter_title = ogTitle
  seoMeta._yoast_wpseo_twitter_description = ogDescription
  if (heroImageUrl) {
    seoMeta._yoast_wpseo_twitter_image = heroImageUrl
  }

  // Rank Math OG fields
  seoMeta.rank_math_facebook_title = ogTitle
  seoMeta.rank_math_facebook_description = ogDescription
  if (heroImageUrl) {
    seoMeta.rank_math_facebook_image = heroImageUrl
  }
  seoMeta.rank_math_twitter_title = ogTitle
  seoMeta.rank_math_twitter_description = ogDescription
  if (heroImageUrl) {
    seoMeta.rank_math_twitter_image = heroImageUrl
  }
  seoMeta.rank_math_twitter_card_type = 'summary_large_image'

  // Canonical URL
  if (articleUrl) {
    seoMeta._yoast_wpseo_canonical = articleUrl
    seoMeta.rank_math_canonical_url = articleUrl
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
    // Create new post as draft (review before going live)
    const result = await createPost(article.site_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || article.keyword.toLowerCase().replace(/\s+/g, '-'),
      status: 'draft',
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

  // 8. Request Google indexing (fire-and-forget, non-blocking)
  let indexingRequested = false
  try {
    const { requestIndexing } = await import('@/lib/seo/indexing-api')
    const indexResult = await requestIndexing(wpUrl, 'URL_UPDATED')
    indexingRequested = indexResult.success
    if (indexResult.success) {
      console.log(`[publish] Google Indexing API notifie pour ${wpUrl}`)
    } else {
      console.warn(`[publish] Indexing API echec: ${indexResult.error}`)
    }
    // Store in serp_data
    const existingSerpData = (article.serp_data || {}) as Record<string, unknown>
    const indexingHistory = (existingSerpData.indexing_requests || []) as Record<string, unknown>[]
    indexingHistory.push({
      requestedAt: now,
      url: wpUrl,
      success: indexResult.success,
      notifyTime: indexResult.notifyTime || null,
      error: indexResult.error || null,
      trigger: 'auto-publish',
    })
    if (indexingHistory.length > 10) indexingHistory.splice(0, indexingHistory.length - 10)
    await supabase
      .from('seo_articles')
      .update({ serp_data: { ...existingSerpData, indexing_requests: indexingHistory } })
      .eq('id', article.id)
  } catch (err) {
    console.warn('[publish] Google Indexing request failed (non-blocking):', err)
  }

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
      indexingRequested,
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

/**
 * Repair truncated HTML: ensure all opened tags (<table>, <thead>, <tbody>, <tr>, <th>, <td>, <ul>, <ol>, <li>, <div>, <details>, <summary>)
 * are properly closed. Also removes completely broken/truncated tags (tag that ends mid-attribute).
 */
function repairTruncatedHtml(html: string): string {
  // 1. Remove any tag that is clearly truncated (opened but never closed with >)
  //    e.g. <table style="width:100%"><thead><tr><th style="background:#2D5A27;color:#FFFFFF
  //    This pattern finds the last < that has no matching >
  const lastOpen = html.lastIndexOf('<')
  if (lastOpen !== -1) {
    const lastClose = html.indexOf('>', lastOpen)
    if (lastClose === -1) {
      // The HTML ends with an unclosed tag — truncate it
      html = html.substring(0, lastOpen).trim()
    }
  }

  // 2. Count open/close for block-level elements and close any unclosed ones
  const pairedTags = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'div', 'details', 'summary', 'figure', 'figcaption']
  const openCounts: Record<string, number> = {}

  for (const tag of pairedTags) {
    const openMatches = html.match(new RegExp(`<${tag}[\\s>]`, 'gi'))
    const closeMatches = html.match(new RegExp(`</${tag}>`, 'gi'))
    const opens = openMatches ? openMatches.length : 0
    const closes = closeMatches ? closeMatches.length : 0
    openCounts[tag] = opens - closes
  }

  // Close unclosed tags in reverse nesting order (inner first)
  const closingOrder = ['figcaption', 'figure', 'summary', 'li', 'td', 'th', 'tr', 'tfoot', 'tbody', 'thead', 'table', 'ol', 'ul', 'div', 'details']
  let suffix = ''
  for (const tag of closingOrder) {
    const unclosed = openCounts[tag] || 0
    for (let i = 0; i < unclosed; i++) {
      suffix += `</${tag}>`
    }
  }

  return html + suffix
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').length : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// GDS PUBLISH — Publication vers GestionnaireDeSite (parallèle WordPress)
// Aucune modification des fonctions WordPress existantes.
// ─────────────────────────────────────────────────────────────────────────────

async function executeGdsPublish(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // 1. Récupère la config GDS du site (colonnes ajoutées par sql/006-gds.sql)
  const { data: siteRow } = await supabase
    .from('seo_sites')
    .select('gds_url, gds_api_token, gds_author, gds_category_map, domain, publication_target')
    .eq('id', article.site_id)
    .single()

  if (!siteRow?.gds_url || !siteRow?.gds_api_token) {
    return {
      success: false,
      runId: '',
      error: 'Site non configuré pour GDS: gds_url et gds_api_token requis (Settings → site)',
    }
  }

  const { publishToGds } = await import('@/lib/gds/publisher')

  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const persona = article.seo_personas as { name?: string } | null

  // 2. Récupère l'article depuis Supabase pour les champs GDS existants
  const { data: articleRow } = await supabase
    .from('seo_articles')
    .select('gds_slug')
    .eq('id', article.id)
    .single()

  const existingGdsSlug = (articleRow?.gds_slug as string | null) || null

  // 3. Publie vers GDS
  const result = await publishToGds({
    articleId: article.id,
    title: article.title || article.keyword,
    slug: article.slug || article.keyword.toLowerCase().replace(/\s+/g, '-'),
    metaDescription: article.meta_description,
    keyword: article.keyword,
    category: (article.seo_sites as { niche?: string } | null)?.niche || null,
    personaName: persona?.name || null,
    date: article.published_at
      ? new Date(article.published_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    tags: article.keyword
      .split(/\s+/)
      .filter((w: string) => w.length >= 4)
      .slice(0, 5),
    contentBlocks,
    heroImageUrl: (article as Record<string, unknown>).hero_image_url as string | null,
    jsonLd: article.json_ld as Record<string, unknown> | null,
    existingGdsSlug,
    siteConfig: {
      gdsUrl: siteRow.gds_url,
      apiToken: siteRow.gds_api_token,
      gdsAuthor: siteRow.gds_author || 'mathilde',
      categoryMap: (siteRow.gds_category_map as Record<string, string>) || {},
      siteDomain: siteRow.domain || undefined,
    },
  })

  if (!result.success) {
    return { success: false, runId: '', error: result.error || 'Erreur publication GDS' }
  }

  // 4. Persiste les champs GDS dans seo_articles
  const now = new Date().toISOString()
  await supabase
    .from('seo_articles')
    .update({
      gds_slug: result.gdsSlug,
      gds_url: result.gdsUrl,
      gds_published_at: now,
      published_at: article.published_at || now,
    } as Record<string, unknown>)
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      gdsSlug: result.gdsSlug,
      gdsUrl: result.gdsUrl,
      heroGdsPath: result.heroGdsPath,
      publishedAt: now,
    },
  }
}

function estimateCost(tokensIn: number, tokensOut: number, model: string, thinkingTokens?: number): number {
  return estimateResponseCost({
    content: '',
    model,
    provider: 'google',
    tokensIn,
    tokensOut,
    durationMs: 0,
    thinkingTokens,
  })
}

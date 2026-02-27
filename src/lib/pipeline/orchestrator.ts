import { getServerClient } from '@/lib/supabase/client'
import type { Article, ArticleStatus, ContentBlock, AuthorityLinkSuggestion, SelectedAuthorityLink } from '@/lib/supabase/types'
import type { PipelineStep, PipelineContext, PipelineRunResult } from './types'

// Article with joined relations from Supabase query
type ArticleWithRelations = Article & {
  seo_personas: { name: string; role: string; tone_description: string | null; bio: string | null; writing_style_examples: Record<string, unknown>[] } | null
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
import { generateSeoFilename, generateAltText } from '@/lib/media/seo-rename'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema, assembleJsonLd } from '@/lib/seo/json-ld'
import { generateInternalLinks, injectLinksIntoHtml } from '@/lib/seo/internal-links'
import { createPost, updatePost, uploadMedia, findOrCreateCategory } from '@/lib/wordpress/client'

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
    .select('*, seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio, writing_style_examples), seo_sites!seo_articles_site_id_fkey(name, domain, niche, theme_color, money_page_url, money_page_description)')
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
        result = await executeRefresh(article as ArticleWithRelations)
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

    await supabase
      .from('seo_pipeline_runs')
      .update({ status: 'error', error: errorMessage, duration_ms: duration })
      .eq('id', run.id)

    return { success: false, runId: run.id, error: errorMessage, durationMs: duration }
  }
}

// ---- Step implementations ----

async function executeAnalyze(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // 1. SERP analysis
  let serpData = null
  let competitorInsights = null
  try {
    serpData = await analyzeSERP(article.keyword)
    competitorInsights = extractCompetitorInsights(serpData)
  } catch (error) {
    // SERP analysis is optional - continue if API key not set
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('non configur') && !msg.includes('not found')) throw error
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

          const cleaned = aiResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          semanticAnalysis = JSON.parse(cleaned)
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

  // Fetch nuggets for this site
  const { data: nuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags')
    .or(`site_id.eq.${article.site_id},site_id.is.null`)
    .limit(20)

  // Fetch ALL published/written articles from the same site for internal linking
  const { data: siteArticlesData } = await supabase
    .from('seo_articles')
    .select('keyword, title, slug')
    .eq('site_id', article.site_id)
    .neq('id', article.id)
    .not('slug', 'is', null)
    .not('title', 'is', null)
    .limit(100)
  const siteArticles = (siteArticlesData || []) as { keyword: string; title: string | null; slug: string | null }[]

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null; writing_style_examples: Record<string, unknown>[] } | null
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
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null, writing_style_examples: [] },
    serpData: serpDataRaw?.serp as Parameters<typeof buildPlanArchitectPrompt>[0]['serpData'],
    nuggets: (nuggets || []).map((n) => ({ id: n.id, content: n.content, tags: n.tags })),
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
    const cleaned = aiResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    plan = JSON.parse(cleaned)
  } catch {
    return {
      success: false,
      runId: '',
      error: 'Impossible de parser le plan genere par l\'IA',
      tokensIn: aiResponse.tokensIn,
      tokensOut: aiResponse.tokensOut,
      modelUsed: aiResponse.model,
    }
  }

  // Ensure intro block exists as first element (type paragraph, heading null, before first H2)
  const blocks = plan.content_blocks || []
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
      const evalCleaned = evalResponse.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const evalParsed = JSON.parse(evalCleaned) as { selections: { index: number; rationale: string; anchor_context: string }[] }

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

  // Fetch nuggets assigned to this block or matching the article
  const { data: nuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags')
    .or(`site_id.eq.${article.site_id},site_id.is.null`)
    .limit(5)

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null; writing_style_examples: Record<string, unknown>[] } | null
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

  const prompt = buildBlockWriterPrompt({
    keyword: article.keyword,
    searchIntent: article.search_intent,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null, writing_style_examples: [] },
    block: {
      type: block.type,
      heading: block.heading ?? null,
      word_count: block.word_count,
      writing_directive: block.writing_directive,
      format_hint: block.format_hint,
    },
    nuggets: (nuggets || []).map((n: { id: string; content: string; tags: string[] }) => ({ id: n.id, content: n.content, tags: n.tags })),
    previousHeadings,
    articleTitle: article.title || article.keyword,
    internalLinkTargets,
    siteDomain: siteDomain || undefined,
    authorityLink: shouldInjectAuth ? selectedAuth : null,
    siteThemeColor: article.seo_sites?.theme_color || undefined,
  })

  const aiResponse = modelOverride
    ? await routeAIWithOverrides('write_block', [{ role: 'user', content: prompt.user }], prompt.system, modelOverride)
    : await routeAI('write_block', [{ role: 'user', content: prompt.user }], prompt.system)

  // Update the specific block
  const updatedBlocks = [...contentBlocks]
  updatedBlocks[blockIndex] = {
    ...block,
    content_html: aiResponse.content,
    status: 'written' as const,
    model_used: aiResponse.model,
    word_count: countWords(aiResponse.content),
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
    })
    heroMediaId = wpMedia.mediaId
  } catch (error) {
    // Hero image generation is optional - continue with blocks
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('non configure') && !msg.includes('FAL_KEY')) throw error
  }

  // 2. Generate images for 'image' type blocks AND H2 blocks with generate_image === true
  const updatedBlocks = [...contentBlocks]
  for (let i = 0; i < updatedBlocks.length; i++) {
    const block = updatedBlocks[i]

    const isImageBlock = block.type === 'image' && !(block.content_html && block.content_html.includes('<img'))
    const isH2WithImage = block.type === 'h2' && block.generate_image === true && !(block.content_html && block.content_html.includes('<img'))

    if (!isImageBlock && !isH2WithImage) {
      continue
    }

    try {
      const promptContext = block.image_prompt_hint || block.heading || ''
      const prompt = buildImagePrompt(article.keyword, promptContext, article.title || article.keyword)
      const imageResult = await generateImage(prompt, { aspectRatio: "16:9" })
      const imgBuffer = await fetch(imageResult.url).then(r => r.arrayBuffer())
      const optimized = await optimizeForWeb(Buffer.from(imgBuffer))
      const filename = generateSeoFilename(article.keyword, block.heading || null, 'section')
      const altText = generateAltText(article.keyword, block.heading || null, 'section', block.image_prompt_hint)

      const wpMedia = await uploadMedia(article.site_id, {
        buffer: optimized.buffer,
        filename,
        altText,
      })

      if (isImageBlock) {
        // For dedicated image blocks: replace content entirely
        updatedBlocks[i] = {
          ...block,
          content_html: `<figure><img src="${wpMedia.url}" alt="${altText}" width="${optimized.width}" height="${optimized.height}" loading="lazy" />${block.heading ? `<figcaption>${block.heading}</figcaption>` : ''}</figure>`,
          status: 'written' as const,
        }
      } else {
        // For H2 blocks: prepend image before existing content
        const imageHtml = `<figure class="section-image"><img src="${wpMedia.url}" alt="${altText}" width="${optimized.width}" height="${optimized.height}" loading="lazy" /></figure>`
        updatedBlocks[i] = {
          ...block,
          content_html: imageHtml + (block.content_html || ''),
        }
      }

      uploadedImages.push({ blockIndex: i, url: wpMedia.url, mediaId: wpMedia.mediaId })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('non configure') && !msg.includes('FAL_KEY')) throw error
    }
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
  )
  schemas.push(breadcrumb)

  const jsonLd = assembleJsonLd(schemas)

  // 2. Internal links (if article is in a silo)
  let linksInjected = 0
  let updatedBlocks = [...contentBlocks]
  if (article.silo_id) {
    const linkSuggestions = await generateInternalLinks(article.id, article.silo_id)
    const linksToInject = linkSuggestions
      .filter(l => l.targetSlug)
      .map(l => ({
        anchorText: l.anchorText,
        url: `https://${site?.domain || ''}/${l.targetSlug}`,
      }))

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
  }

  // 3. Verify meta description
  const metaDesc = article.meta_description || ''
  const metaDescLength = metaDesc.length
  const metaDescOk = metaDescLength >= 120 && metaDescLength <= 160

  // 4. Calculate nugget density
  const blocksWithNuggets = contentBlocks.filter(b => b.nugget_ids && b.nugget_ids.length > 0).length
  const nuggetDensity = contentBlocks.length > 0 ? blocksWithNuggets / contentBlocks.length : 0

  // 5. Update article
  await supabase
    .from('seo_articles')
    .update({
      json_ld: jsonLd,
      content_blocks: updatedBlocks,
      nugget_density_score: nuggetDensity,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      schemasGenerated: schemas.length,
      linksInjected,
      metaDescription: { length: metaDescLength, ok: metaDescOk },
      nuggetDensity: Math.round(nuggetDensity * 100),
    },
  }
}

// ---- Publish step ----

async function executePublish(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()
  const contentBlocks = (article.content_blocks || []) as ContentBlock[]
  const site = article.seo_sites

  // 1. Assemble full HTML from content blocks
  const htmlParts: string[] = []
  for (const block of contentBlocks) {
    if (!block.content_html) continue
    if (block.heading && (block.type === 'h2' || block.type === 'h3')) {
      const tag = block.type
      htmlParts.push(`<${tag}>${block.heading}</${tag}>`)
    }
    htmlParts.push(block.content_html)
  }

  // Inject JSON-LD script tag at the end
  const jsonLd = article.json_ld as Record<string, unknown> | null
  if (jsonLd) {
    htmlParts.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`)
  }

  const fullHtml = htmlParts.join('\n\n')

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

  // 4. Find or create WP category based on site niche
  let categoryIds: number[] | undefined
  try {
    if (site?.niche) {
      const catId = await findOrCreateCategory(article.site_id, site.niche)
      categoryIds = [catId]
    }
  } catch {
    // Category assignment is optional — continue without it
  }

  // 5. Build SEO meta for Yoast/Rank Math
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
      status: 'draft',
      excerpt,
      featured_media: heroMediaId,
      categories: categoryIds,
      ...(hasSeoMeta ? { meta: seoMeta } : {}),
    })
    wpPostId = wpPost.id
    wpUrl = wpPost.link
  } else {
    // Create new post as draft
    const result = await createPost(article.site_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || article.keyword.toLowerCase().replace(/\s+/g, '-'),
      status: 'draft',
      excerpt,
      featured_media: heroMediaId,
      categories: categoryIds,
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
      status: 'draft',
      excerpt: excerpt.slice(0, 100) + '...',
      category: site?.niche || null,
      seoMeta: hasSeoMeta ? Object.keys(seoMeta) : [],
    },
  }
}

// ---- Refresh step ----

async function executeRefresh(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

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

  // 2. Update article with fresh SERP data and mark for refresh
  await supabase
    .from('seo_articles')
    .update({
      serp_data: serpUpdate || article.serp_data,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      serpUpdated: !!serpUpdate,
      message: 'Article marque pour mise a jour. Utilisez write_block pour actualiser le contenu.',
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

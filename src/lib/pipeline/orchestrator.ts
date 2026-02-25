import { getServerClient } from '@/lib/supabase/client'
import type { Article, ArticleStatus, ContentBlock } from '@/lib/supabase/types'
import type { PipelineStep, PipelineContext, PipelineRunResult } from './types'

// Article with joined relations from Supabase query
type ArticleWithRelations = Article & {
  seo_personas: { name: string; role: string; tone_description: string | null; bio: string | null } | null
  seo_sites: { name: string; domain: string; niche: string | null } | null
}
import { validateTransition, getNextStatus } from './state-machine'
import { analyzeSERP, extractCompetitorInsights } from '@/lib/seo/serper'
import { checkCannibalization } from '@/lib/seo/anti-cannibal'
import { routeAI } from '@/lib/ai/router'
import { buildPlanArchitectPrompt } from '@/lib/ai/prompts/plan-architect'
import { buildBlockWriterPrompt } from '@/lib/ai/prompts/block-writer'
import { generateImage, buildImagePrompt, generateHeroImage } from '@/lib/media/fal-ai'
import { optimizeForWeb } from '@/lib/media/sharp-processor'
import { generateSeoFilename, generateAltText } from '@/lib/media/seo-rename'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema, assembleJsonLd } from '@/lib/seo/json-ld'
import { generateInternalLinks, injectLinksIntoHtml } from '@/lib/seo/internal-links'
import { createPost, updatePost, uploadMedia } from '@/lib/wordpress/client'

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
    .select('*, seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio), seo_sites!seo_articles_site_id_fkey(name, domain, niche)')
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

  try {
    let result: PipelineRunResult

    switch (step) {
      case 'analyze':
        result = await executeAnalyze(article as ArticleWithRelations)
        break
      case 'plan':
        result = await executePlan(article as ArticleWithRelations)
        break
      case 'write_block':
        result = await executeWriteBlock(article as ArticleWithRelations, input)
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
    if (!msg.includes('non configure')) throw error
  }

  // 2. Cannibalization check
  const cannibalization = await checkCannibalization(article.keyword, article.site_id, article.id)

  // 3. Update article with SERP data
  await supabase
    .from('seo_articles')
    .update({
      serp_data: serpData ? { serp: serpData, insights: competitorInsights } : null,
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
    },
  }
}

async function executePlan(
  article: ArticleWithRelations,
): Promise<PipelineRunResult> {
  const supabase = getServerClient()

  // Fetch nuggets for this site
  const { data: nuggets } = await supabase
    .from('seo_nuggets')
    .select('id, content, tags')
    .or(`site_id.eq.${article.site_id},site_id.is.null`)
    .limit(20)

  // Fetch existing silo articles for internal linking context
  let siloArticles: { keyword: string; title: string | null; slug: string | null }[] = []
  if (article.silo_id) {
    const { data } = await supabase
      .from('seo_articles')
      .select('keyword, title, slug')
      .eq('silo_id', article.silo_id)
      .neq('id', article.id)
      .not('title', 'is', null)
    siloArticles = (data || []) as { keyword: string; title: string | null; slug: string | null }[]
  }

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null } | null
  const serpDataRaw = article.serp_data as { serp?: { organic: { title: string; snippet: string }[]; peopleAlsoAsk: { question: string }[] } } | null

  // Build prompt and call AI
  const prompt = buildPlanArchitectPrompt({
    keyword: article.keyword,
    searchIntent: article.search_intent,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null },
    serpData: serpDataRaw?.serp as Parameters<typeof buildPlanArchitectPrompt>[0]['serpData'],
    nuggets: (nuggets || []).map((n) => ({ id: n.id, content: n.content, tags: n.tags })),
    existingSiloArticles: siloArticles,
  })

  const aiResponse = await routeAI('plan_article', [{ role: 'user', content: prompt.user }], prompt.system)

  // Parse the AI response as JSON plan
  let plan: { title: string; meta_description: string; slug: string; content_blocks: ContentBlock[] }
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

  // Update article with the generated plan
  await supabase
    .from('seo_articles')
    .update({
      title: plan.title,
      meta_description: plan.meta_description,
      slug: plan.slug,
      content_blocks: plan.content_blocks,
      status: 'planning' as ArticleStatus,
    })
    .eq('id', article.id)

  return {
    success: true,
    runId: '',
    output: {
      title: plan.title,
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
  input?: Record<string, unknown>
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

  const persona = article.seo_personas as { name: string; role: string; tone_description: string | null; bio: string | null } | null
  const previousHeadings = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.heading)
    .map((b: ContentBlock) => b.heading!)

  const prompt = buildBlockWriterPrompt({
    keyword: article.keyword,
    persona: persona || { name: 'Expert', role: 'Redacteur', tone_description: null, bio: null },
    block: { type: block.type, heading: block.heading ?? null, word_count: block.word_count },
    nuggets: (nuggets || []).map((n: { id: string; content: string; tags: string[] }) => ({ id: n.id, content: n.content, tags: n.tags })),
    previousHeadings,
    articleTitle: article.title || article.keyword,
  })

  const aiResponse = await routeAI('write_block', [{ role: 'user', content: prompt.user }], prompt.system)

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
    const filename = generateSeoFilename(article.keyword, 'hero', 0)
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

  // 2. Generate images for 'image' type blocks
  const updatedBlocks = [...contentBlocks]
  for (let i = 0; i < updatedBlocks.length; i++) {
    const block = updatedBlocks[i]
    if (block.type !== 'image' || (block.content_html && block.content_html.includes('<img'))) {
      continue
    }

    try {
      const prompt = buildImagePrompt(article.keyword, block.heading || '', article.title || article.keyword)
      const imageResult = await generateImage(prompt, { width: 1200, height: 800 })
      const imgBuffer = await fetch(imageResult.url).then(r => r.arrayBuffer())
      const optimized = await optimizeForWeb(Buffer.from(imgBuffer))
      const filename = generateSeoFilename(article.keyword, block.heading || 'illustration', i + 1)
      const altText = generateAltText(article.keyword, block.heading || null, block.type)

      const wpMedia = await uploadMedia(article.site_id, {
        buffer: optimized.buffer,
        filename,
        altText,
      })

      updatedBlocks[i] = {
        ...block,
        content_html: `<figure><img src="${wpMedia.url}" alt="${altText}" width="${optimized.width}" height="${optimized.height}" loading="lazy" />${block.heading ? `<figcaption>${block.heading}</figcaption>` : ''}</figure>`,
        status: 'written' as const,
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

  // FAQ schema (from FAQ blocks)
  const faqBlocks = contentBlocks.filter(b => b.type === 'faq' && b.content_html)
  if (faqBlocks.length > 0) {
    const faqItems = faqBlocks.map(b => ({
      question: b.heading || '',
      answer: b.content_html.replace(/<[^>]*>/g, '').trim(),
    })).filter(item => item.question && item.answer)

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

  // 2. Fetch previous pipeline run to get hero media ID
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

  // 3. Create or update WordPress post
  let wpPostId: number
  let wpUrl: string

  if (article.wp_post_id) {
    // Update existing post
    const wpPost = await updatePost(article.site_id, article.wp_post_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || undefined,
      status: 'publish',
      featured_media: heroMediaId,
    })
    wpPostId = wpPost.id
    wpUrl = wpPost.link
  } else {
    // Create new post
    const result = await createPost(article.site_id, {
      title: article.title || article.keyword,
      content: fullHtml,
      slug: article.slug || article.keyword.toLowerCase().replace(/\s+/g, '-'),
      status: 'publish',
      featured_media: heroMediaId,
    })
    wpPostId = result.wpPostId
    wpUrl = result.wpUrl
  }

  // 4. Update article with WP data
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
      publishedAt: article.published_at || now,
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
  return 0
}

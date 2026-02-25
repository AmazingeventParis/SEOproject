import { getServerClient } from "@/lib/supabase/client"

// ---- Interfaces ----

export interface CostSummary {
  totalCostUsd: number
  totalTokensIn: number
  totalTokensOut: number
  totalRuns: number
  successfulRuns: number
  avgCostPerArticle: number
  byModel: { model: string; cost: number; runs: number; tokensIn: number; tokensOut: number }[]
  byStep: { step: string; cost: number; runs: number; avgDurationMs: number }[]
}

export interface DailyCost {
  date: string
  cost: number
  runs: number
  tokensIn: number
  tokensOut: number
}

export interface ArticleCost {
  articleId: string
  keyword: string
  title: string | null
  totalCost: number
  totalTokensIn: number
  totalTokensOut: number
  runCount: number
}

export interface BudgetAlert {
  currentSpend: number
  budget: number
  percentUsed: number
  isAlert: boolean
}

// ---- Row type used internally ----

interface PipelineRunRow {
  id: string
  article_id: string
  step: string
  status: string
  model_used: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: number
  duration_ms: number
  created_at: string
}

// ---- Functions ----

export async function getCostSummary(options?: {
  siteId?: string
  fromDate?: string
  toDate?: string
}): Promise<CostSummary> {
  const supabase = getServerClient()

  let articleIds: string[] | null = null

  // If siteId is provided, first get article IDs for that site
  if (options?.siteId) {
    const { data: articles, error: articlesError } = await supabase
      .from("seo_articles")
      .select("id")
      .eq("site_id", options.siteId)

    if (articlesError) {
      throw new Error(`Erreur lors du chargement des articles: ${articlesError.message}`)
    }

    articleIds = (articles ?? []).map((a) => a.id)

    if (articleIds.length === 0) {
      return {
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalRuns: 0,
        successfulRuns: 0,
        avgCostPerArticle: 0,
        byModel: [],
        byStep: [],
      }
    }
  }

  // Build query for pipeline runs
  let query = supabase
    .from("seo_pipeline_runs")
    .select("id, article_id, step, status, model_used, tokens_in, tokens_out, cost_usd, duration_ms, created_at")

  if (options?.fromDate) {
    query = query.gte("created_at", options.fromDate)
  }
  if (options?.toDate) {
    query = query.lte("created_at", options.toDate)
  }
  if (articleIds) {
    query = query.in("article_id", articleIds)
  }

  const { data: runs, error } = await query

  if (error) {
    throw new Error(`Erreur lors du chargement des runs: ${error.message}`)
  }

  const rows = (runs ?? []) as PipelineRunRow[]

  // Aggregate totals
  let totalCostUsd = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let successfulRuns = 0
  const distinctArticles = new Set<string>()

  const modelMap = new Map<string, { cost: number; runs: number; tokensIn: number; tokensOut: number }>()
  const stepMap = new Map<string, { cost: number; runs: number; totalDurationMs: number }>()

  for (const row of rows) {
    totalCostUsd += row.cost_usd
    totalTokensIn += row.tokens_in
    totalTokensOut += row.tokens_out
    distinctArticles.add(row.article_id)

    if (row.status === "success") {
      successfulRuns++
    }

    // By model
    const modelKey = row.model_used ?? "inconnu"
    const modelEntry = modelMap.get(modelKey) ?? { cost: 0, runs: 0, tokensIn: 0, tokensOut: 0 }
    modelEntry.cost += row.cost_usd
    modelEntry.runs += 1
    modelEntry.tokensIn += row.tokens_in
    modelEntry.tokensOut += row.tokens_out
    modelMap.set(modelKey, modelEntry)

    // By step
    const stepEntry = stepMap.get(row.step) ?? { cost: 0, runs: 0, totalDurationMs: 0 }
    stepEntry.cost += row.cost_usd
    stepEntry.runs += 1
    stepEntry.totalDurationMs += row.duration_ms
    stepMap.set(row.step, stepEntry)
  }

  const totalRuns = rows.length
  const articleCount = distinctArticles.size
  const avgCostPerArticle = articleCount > 0 ? totalCostUsd / articleCount : 0

  const byModel = Array.from(modelMap.entries()).map(([model, data]) => ({
    model,
    cost: data.cost,
    runs: data.runs,
    tokensIn: data.tokensIn,
    tokensOut: data.tokensOut,
  }))

  const byStep = Array.from(stepMap.entries()).map(([step, data]) => ({
    step,
    cost: data.cost,
    runs: data.runs,
    avgDurationMs: data.runs > 0 ? data.totalDurationMs / data.runs : 0,
  }))

  return {
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    totalRuns,
    successfulRuns,
    avgCostPerArticle,
    byModel,
    byStep,
  }
}

export async function getDailyCosts(days: number = 30): Promise<DailyCost[]> {
  const supabase = getServerClient()

  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - days)
  const fromDateStr = fromDate.toISOString()

  const { data: runs, error } = await supabase
    .from("seo_pipeline_runs")
    .select("cost_usd, tokens_in, tokens_out, created_at")
    .gte("created_at", fromDateStr)
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Erreur lors du chargement des couts journaliers: ${error.message}`)
  }

  const dayMap = new Map<string, { cost: number; runs: number; tokensIn: number; tokensOut: number }>()

  for (const row of runs ?? []) {
    const dateKey = row.created_at.substring(0, 10) // YYYY-MM-DD
    const entry = dayMap.get(dateKey) ?? { cost: 0, runs: 0, tokensIn: 0, tokensOut: 0 }
    entry.cost += row.cost_usd
    entry.runs += 1
    entry.tokensIn += row.tokens_in
    entry.tokensOut += row.tokens_out
    dayMap.set(dateKey, entry)
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      cost: data.cost,
      runs: data.runs,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
    }))
}

export async function getMostExpensiveArticles(limit: number = 10): Promise<ArticleCost[]> {
  const supabase = getServerClient()

  // Fetch all pipeline runs (select only needed fields)
  const { data: runs, error: runsError } = await supabase
    .from("seo_pipeline_runs")
    .select("article_id, cost_usd, tokens_in, tokens_out")

  if (runsError) {
    throw new Error(`Erreur lors du chargement des runs: ${runsError.message}`)
  }

  // Aggregate by article_id
  const articleMap = new Map<string, { totalCost: number; totalTokensIn: number; totalTokensOut: number; runCount: number }>()

  for (const row of runs ?? []) {
    const entry = articleMap.get(row.article_id) ?? { totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, runCount: 0 }
    entry.totalCost += row.cost_usd
    entry.totalTokensIn += row.tokens_in
    entry.totalTokensOut += row.tokens_out
    entry.runCount += 1
    articleMap.set(row.article_id, entry)
  }

  // Sort by cost desc and take top N
  const sorted = Array.from(articleMap.entries())
    .sort(([, a], [, b]) => b.totalCost - a.totalCost)
    .slice(0, limit)

  if (sorted.length === 0) {
    return []
  }

  // Fetch article details for the top N
  const topArticleIds = sorted.map(([id]) => id)
  const { data: articles, error: articlesError } = await supabase
    .from("seo_articles")
    .select("id, keyword, title")
    .in("id", topArticleIds)

  if (articlesError) {
    throw new Error(`Erreur lors du chargement des articles: ${articlesError.message}`)
  }

  const articlesById = new Map((articles ?? []).map((a) => [a.id, a]))

  return sorted.map(([articleId, data]) => {
    const article = articlesById.get(articleId)
    return {
      articleId,
      keyword: article?.keyword ?? "Inconnu",
      title: article?.title ?? null,
      totalCost: data.totalCost,
      totalTokensIn: data.totalTokensIn,
      totalTokensOut: data.totalTokensOut,
      runCount: data.runCount,
    }
  })
}

export async function checkBudgetAlert(monthlyBudgetUsd: number): Promise<BudgetAlert> {
  const supabase = getServerClient()

  // Get the first day of the current month
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data: runs, error } = await supabase
    .from("seo_pipeline_runs")
    .select("cost_usd")
    .gte("created_at", firstOfMonth)

  if (error) {
    throw new Error(`Erreur lors du chargement du budget: ${error.message}`)
  }

  let currentSpend = 0
  for (const row of runs ?? []) {
    currentSpend += row.cost_usd
  }

  const percentUsed = monthlyBudgetUsd > 0 ? (currentSpend / monthlyBudgetUsd) * 100 : 0

  return {
    currentSpend,
    budget: monthlyBudgetUsd,
    percentUsed,
    isAlert: percentUsed >= 80,
  }
}

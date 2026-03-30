import { NextResponse } from "next/server"
import { getServerClient } from "@/lib/supabase/client"

export async function GET() {
  try {
    const supabase = getServerClient()

    // Current calendar month boundaries
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    // Run all queries in parallel
    const [
      articlesRes,
      sitesRes,
      runsThisMonthRes,
      topArticlesRes,
      budgetConfigRes,
    ] = await Promise.all([
      // All articles with minimal fields
      supabase
        .from("seo_articles")
        .select("id, keyword, title, status, site_id, wp_post_id, wp_url, serp_data, updated_at, created_at")
        .order("updated_at", { ascending: false })
        .limit(500),

      // Sites count
      supabase
        .from("seo_sites")
        .select("id, name, domain, active")
        .eq("active", true),

      // Pipeline runs this calendar month
      supabase
        .from("seo_pipeline_runs")
        .select("article_id, step, status, cost_usd, tokens_in, tokens_out, created_at")
        .gte("created_at", firstOfMonth),

      // Top expensive articles (all time, last 500 runs with cost)
      supabase
        .from("seo_pipeline_runs")
        .select("article_id, cost_usd")
        .gt("cost_usd", 0)
        .order("cost_usd", { ascending: false })
        .limit(500),

      // Budget config
      supabase
        .from("seo_config")
        .select("value")
        .eq("key", "monthly_budget_usd")
        .single(),
    ])

    const articles = articlesRes.data ?? []
    const sites = sitesRes.data ?? []
    const runsThisMonth = runsThisMonthRes.data ?? []
    const topRuns = topArticlesRes.data ?? []

    // --- Article counts ---
    const activeStatuses = ["analyzing", "planning", "writing", "media", "seo_check", "reviewing"]
    const publishedCount = articles.filter(a => a.status === "published").length
    const pipelineCount = articles.filter(a => activeStatuses.includes(a.status)).length
    const refreshNeededCount = articles.filter(a => a.status === "refresh_needed").length

    // Articles published in pipeline but still draft in WP (have wp_post_id but were just published)
    // We detect "draft WP" by checking articles with status=published that have a wp_post_id
    // Since we can't query WP status from here, we track articles that haven't been "go-live"d
    // by checking serp_data.indexing_requests for 'go-live' trigger
    const draftWpArticles = articles.filter(a => {
      if (a.status !== "published" || !a.wp_post_id) return false
      const serpData = (a.serp_data || {}) as Record<string, unknown>
      const indexingReqs = (serpData.indexing_requests || []) as { trigger?: string }[]
      const hasGoLive = indexingReqs.some(r => r.trigger === "go-live")
      return !hasGoLive
    })

    // --- Cost this calendar month ---
    let monthCost = 0
    let monthTokensIn = 0
    let monthTokensOut = 0
    let monthSuccessRuns = 0
    const monthArticleIds = new Set<string>()

    for (const run of runsThisMonth) {
      monthCost += run.cost_usd
      monthTokensIn += run.tokens_in
      monthTokensOut += run.tokens_out
      if (run.status === "success") monthSuccessRuns++
      monthArticleIds.add(run.article_id)
    }

    const monthTotalRuns = runsThisMonth.length
    const monthSuccessRate = monthTotalRuns > 0 ? Math.round((monthSuccessRuns / monthTotalRuns) * 100) : 100
    const avgCostPerArticle = monthArticleIds.size > 0 ? monthCost / monthArticleIds.size : 0

    // --- Budget ---
    let budgetUsd = 50
    if (budgetConfigRes.data?.value) {
      const v = budgetConfigRes.data.value as Record<string, unknown>
      budgetUsd = Number(v.amount ?? v.value ?? v) || 50
    }
    const budgetPercent = budgetUsd > 0 ? Math.round((monthCost / budgetUsd) * 100) : 0

    // --- Top 3 most expensive articles ---
    const articleCostMap = new Map<string, number>()
    for (const run of topRuns) {
      articleCostMap.set(run.article_id, (articleCostMap.get(run.article_id) || 0) + run.cost_usd)
    }
    const top3Ids = Array.from(articleCostMap.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)

    const top3Articles = top3Ids.map(([id, cost]) => {
      const article = articles.find(a => a.id === id)
      return {
        id,
        keyword: article?.keyword ?? "Inconnu",
        cost,
      }
    })

    // --- Recent articles (last 8) ---
    const recentArticles = articles.slice(0, 8).map(a => ({
      id: a.id,
      keyword: a.keyword,
      title: a.title,
      status: a.status,
      updated_at: a.updated_at,
    }))

    // --- Active pipeline (in progress) ---
    const activeArticles = articles
      .filter(a => activeStatuses.includes(a.status))
      .slice(0, 10)
      .map(a => ({
        id: a.id,
        keyword: a.keyword,
        status: a.status,
        updated_at: a.updated_at,
      }))

    // --- Draft WP list ---
    const draftWpList = draftWpArticles.slice(0, 5).map(a => ({
      id: a.id,
      keyword: a.keyword,
      title: a.title,
      wp_url: a.wp_url,
    }))

    return NextResponse.json({
      counts: {
        published: publishedCount,
        pipeline: pipelineCount,
        refreshNeeded: refreshNeededCount,
        draftWp: draftWpArticles.length,
        sites: sites.length,
      },
      cost: {
        monthTotal: monthCost,
        budget: budgetUsd,
        budgetPercent,
        avgPerArticle: avgCostPerArticle,
        tokensIn: monthTokensIn,
        tokensOut: monthTokensOut,
        successRate: monthSuccessRate,
        totalRuns: monthTotalRuns,
      },
      top3Articles,
      recentArticles,
      activeArticles,
      draftWpList,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

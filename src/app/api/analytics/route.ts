import { NextRequest, NextResponse } from "next/server"
import {
  getCostSummary,
  getDailyCosts,
  getMostExpensiveArticles,
  checkBudgetAlert,
} from "@/lib/analytics/cost-tracker"
import { getServerClient } from "@/lib/supabase/client"

function getFromDate(period: string): string | undefined {
  const now = new Date()
  switch (period) {
    case "day": {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      return d.toISOString()
    }
    case "week": {
      const d = new Date(now)
      d.setDate(d.getDate() - 7)
      return d.toISOString()
    }
    case "month": {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 1)
      return d.toISOString()
    }
    case "all":
    default:
      return undefined
  }
}

function getDaysForPeriod(period: string): number {
  switch (period) {
    case "day":
      return 1
    case "week":
      return 7
    case "month":
      return 30
    case "all":
      return 365
    default:
      return 30
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") ?? "month"
    const siteId = searchParams.get("site_id") ?? undefined

    const fromDate = getFromDate(period)
    const days = getDaysForPeriod(period)

    // Run all queries in parallel
    const [summary, daily, topArticles] = await Promise.all([
      getCostSummary({ siteId, fromDate }),
      getDailyCosts(days),
      getMostExpensiveArticles(10),
    ])

    // Check if a monthly budget is configured
    const supabase = getServerClient()
    const { data: configRow } = await supabase
      .from("seo_config")
      .select("value")
      .eq("key", "monthly_budget_usd")
      .single()

    let budget = null
    if (configRow?.value) {
      const configValue = configRow.value as Record<string, unknown>
      const budgetAmount = Number(configValue.amount ?? configValue.value ?? 0)
      if (budgetAmount > 0) {
        budget = await checkBudgetAlert(budgetAmount)
      }
    }

    return NextResponse.json({
      summary,
      daily,
      topArticles,
      budget,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur interne du serveur"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

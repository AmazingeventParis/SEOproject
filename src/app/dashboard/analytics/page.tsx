"use client"

import React, { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { DollarSign, TrendingUp, Zap, BarChart3, AlertTriangle } from "lucide-react"
import type {
  CostSummary,
  DailyCost,
  ArticleCost,
  BudgetAlert,
} from "@/lib/analytics/cost-tracker"

// ---- Step labels in French ----

const STEP_LABELS: Record<string, string> = {
  analyze: "Analyse SERP",
  plan: "Plan de contenu",
  write: "Redaction",
  media: "Medias",
  seo_check: "Verification SEO",
  publish: "Publication",
  refresh: "Rafraichissement",
}

function getStepLabel(step: string): string {
  return STEP_LABELS[step] ?? step
}

// ---- Formatting helpers ----

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`
  }
  return value.toString()
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    return `${(ms / 60_000).toFixed(1)} min`
  }
  if (ms >= 1_000) {
    return `${(ms / 1_000).toFixed(1)}s`
  }
  return `${Math.round(ms)}ms`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

// ---- Period mapping ----

type PeriodValue = "7" | "30" | "90" | "all"

function periodToApiParam(period: PeriodValue): string {
  switch (period) {
    case "7":
      return "week"
    case "30":
      return "month"
    case "90":
      return "month" // Use month; the API will be extended if needed
    case "all":
      return "all"
    default:
      return "month"
  }
}

// ---- API response type ----

interface AnalyticsResponse {
  summary: CostSummary
  daily: DailyCost[]
  topArticles: ArticleCost[]
  budget: BudgetAlert | null
}

// ---- Page component ----

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<PeriodValue>("30")
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const apiPeriod = periodToApiParam(period)
      const res = await fetch(`/api/analytics?period=${apiPeriod}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          (body as { error?: string } | null)?.error ?? `Erreur HTTP ${res.status}`
        )
      }
      const json: AnalyticsResponse = await res.json()
      setData(json)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur inconnue"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">
            Suivi des couts et performances
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodValue)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 jours</SelectItem>
            <SelectItem value="30">30 jours</SelectItem>
            <SelectItem value="90">90 jours</SelectItem>
            <SelectItem value="all">Tout</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {data && !loading && (
        <>
          {/* Stats cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cout total</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatUsd(data.summary.totalCostUsd)}</div>
                <p className="text-xs text-muted-foreground">
                  {data.summary.totalRuns} executions
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cout moyen par article</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatUsd(data.summary.avgCostPerArticle)}</div>
                <p className="text-xs text-muted-foreground">
                  Par article traite
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tokens consommes</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatTokens(data.summary.totalTokensIn + data.summary.totalTokensOut)}
                </div>
                <p className="text-xs text-muted-foreground">
                  In: {formatTokens(data.summary.totalTokensIn)} / Out: {formatTokens(data.summary.totalTokensOut)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Taux de reussite</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {data.summary.totalRuns > 0
                    ? formatPercent((data.summary.successfulRuns / data.summary.totalRuns) * 100)
                    : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.summary.successfulRuns}/{data.summary.totalRuns} reussies
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Budget alert */}
          {data.budget && data.budget.isAlert && (
            <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-sm font-medium text-orange-700 dark:text-orange-400">
                  Alerte budget
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-orange-700 dark:text-orange-400">
                  Vous avez utilise {formatPercent(data.budget.percentUsed)} de votre budget mensuel
                  ({formatUsd(data.budget.currentSpend)} / {formatUsd(data.budget.budget)}).
                </p>
                <Progress
                  value={Math.min(data.budget.percentUsed, 100)}
                  className="h-2"
                />
              </CardContent>
            </Card>
          )}

          {/* By Model breakdown */}
          {data.summary.byModel.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Repartition par modele</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modele</TableHead>
                      <TableHead className="text-right">Cout</TableHead>
                      <TableHead className="text-right">Executions</TableHead>
                      <TableHead className="text-right">Tokens In</TableHead>
                      <TableHead className="text-right">Tokens Out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.summary.byModel.map((row) => (
                      <TableRow key={row.model}>
                        <TableCell>
                          <Badge variant="outline">{row.model}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatUsd(row.cost)}
                        </TableCell>
                        <TableCell className="text-right">{row.runs}</TableCell>
                        <TableCell className="text-right">{formatTokens(row.tokensIn)}</TableCell>
                        <TableCell className="text-right">{formatTokens(row.tokensOut)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* By Step breakdown */}
          {data.summary.byStep.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Repartition par etape</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Etape</TableHead>
                      <TableHead className="text-right">Cout</TableHead>
                      <TableHead className="text-right">Executions</TableHead>
                      <TableHead className="text-right">Duree moyenne</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.summary.byStep.map((row) => (
                      <TableRow key={row.step}>
                        <TableCell>{getStepLabel(row.step)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatUsd(row.cost)}
                        </TableCell>
                        <TableCell className="text-right">{row.runs}</TableCell>
                        <TableCell className="text-right">
                          {formatDuration(row.avgDurationMs)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Most expensive articles */}
          {data.topArticles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Articles les plus couteux</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mot-cle</TableHead>
                      <TableHead>Titre</TableHead>
                      <TableHead className="text-right">Cout total</TableHead>
                      <TableHead className="text-right">Executions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topArticles.map((article) => (
                      <TableRow key={article.articleId}>
                        <TableCell>
                          <Link
                            href={`/dashboard/articles/${article.articleId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {article.keyword}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {article.title ?? "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatUsd(article.totalCost)}
                        </TableCell>
                        <TableCell className="text-right">{article.runCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {data.summary.totalRuns === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <h3 className="text-lg font-semibold">Aucune donnee</h3>
                <p className="text-sm text-muted-foreground">
                  Les statistiques apparaitront apres les premieres executions du pipeline.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

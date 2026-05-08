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
import { Euro, TrendingUp, Zap, BarChart3, AlertTriangle } from "lucide-react"
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

// USD → EUR conversion. Internal cost estimates are computed in USD (provider
// pricing is published in USD); we display in EUR for parity with the
// Google Cloud billing numbers the user sees in the Cloud Console.
const USD_TO_EUR = 0.92

function formatEur(usdValue: number): string {
  const eur = usdValue * USD_TO_EUR
  return `${eur.toFixed(2)} €`
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

// ---- API response types ----

interface AnalyticsResponse {
  summary: CostSummary
  daily: DailyCost[]
  topArticles: ArticleCost[]
  budget: BudgetAlert | null
}

interface GcpBillingStatus {
  configured: boolean
  tablesReady: boolean
  detailedTable: string | null
  standardTable: string | null
  message: string
}

interface GcpDailyCost {
  date: string
  costEur: number
}

interface GcpServiceCost {
  service: string
  costEur: number
  usageAmount: number | null
  usageUnit: string | null
}

interface GcpSkuCost {
  service: string
  sku: string
  costEur: number
  usageAmount: number | null
  usageUnit: string | null
}

interface GcpBillingResponse {
  status: GcpBillingStatus
  daily: GcpDailyCost[]
  byService: GcpServiceCost[]
  bySku: GcpSkuCost[]
}

function formatEurDirect(value: number): string {
  return `${value.toFixed(2)} €`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)
}

// ---- Page component ----

function periodToDays(period: PeriodValue): number {
  switch (period) {
    case "7": return 7
    case "30": return 30
    case "90": return 90
    case "all": return 365
    default: return 30
  }
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<PeriodValue>("30")
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [gcpData, setGcpData] = useState<GcpBillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const apiPeriod = periodToApiParam(period)
      const days = periodToDays(period)
      const [internalRes, gcpRes] = await Promise.all([
        fetch(`/api/analytics?period=${apiPeriod}`),
        fetch(`/api/analytics/gcp-billing?days=${days}`),
      ])
      if (!internalRes.ok) {
        const body = await internalRes.json().catch(() => null)
        throw new Error(
          (body as { error?: string } | null)?.error ?? `Erreur HTTP ${internalRes.status}`
        )
      }
      const internalJson: AnalyticsResponse = await internalRes.json()
      setData(internalJson)

      // GCP billing is best-effort: if it fails or isn't ready, we just don't show it
      if (gcpRes.ok) {
        const gcpJson: GcpBillingResponse = await gcpRes.json()
        setGcpData(gcpJson)
      } else {
        setGcpData(null)
      }
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

      {/* GCP billing section — authoritative cost from BigQuery export */}
      {gcpData && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Euro className="h-4 w-4" />
              Couts reels Google Cloud
              {gcpData.status.tablesReady && (
                <Badge variant="outline" className="ml-2 text-xs">
                  Source: BigQuery export
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!gcpData.status.tablesReady ? (
              <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Donnees pas encore disponibles</p>
                <p className="mt-1">{gcpData.status.message}</p>
              </div>
            ) : (
              <>
                {/* Total over selected period */}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Total facture (periode)</p>
                    <p className="text-2xl font-bold">
                      {formatEurDirect(
                        gcpData.daily.reduce((sum, d) => sum + d.costEur, 0),
                      )}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Pic journalier</p>
                    <p className="text-2xl font-bold">
                      {gcpData.daily.length > 0
                        ? formatEurDirect(Math.max(...gcpData.daily.map((d) => d.costEur)))
                        : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {gcpData.daily.length > 0
                        ? gcpData.daily.reduce((max, d) => (d.costEur > max.costEur ? d : max)).date
                        : ''}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Cout moyen / jour</p>
                    <p className="text-2xl font-bold">
                      {gcpData.daily.length > 0
                        ? formatEurDirect(
                            gcpData.daily.reduce((sum, d) => sum + d.costEur, 0) /
                              gcpData.daily.length,
                          )
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Daily timeline */}
                {gcpData.daily.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Evolution journaliere</p>
                    <div className="space-y-1">
                      {gcpData.daily.slice().reverse().slice(0, 14).map((d) => {
                        const max = Math.max(...gcpData.daily.map((x) => x.costEur))
                        const widthPct = max > 0 ? (d.costEur / max) * 100 : 0
                        return (
                          <div key={d.date} className="flex items-center gap-3 text-sm">
                            <div className="w-24 text-muted-foreground text-xs">{d.date}</div>
                            <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden relative">
                              <div
                                className="absolute inset-y-0 left-0 bg-primary"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                            <div className="w-20 text-right text-xs font-medium">
                              {formatEurDirect(d.costEur)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* By service */}
                {gcpData.byService.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Par service GCP</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead className="text-right">Cout</TableHead>
                          <TableHead className="text-right">Usage</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gcpData.byService.slice(0, 10).map((s) => (
                          <TableRow key={s.service}>
                            <TableCell>{s.service}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatEurDirect(s.costEur)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {s.usageAmount != null
                                ? `${formatNumber(s.usageAmount)} ${s.usageUnit ?? ''}`.trim()
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* By SKU (detailed export only) */}
                {gcpData.bySku.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Par SKU (top 10)</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-right">Cout</TableHead>
                          <TableHead className="text-right">Usage</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gcpData.bySku.slice(0, 10).map((s) => (
                          <TableRow key={`${s.service}-${s.sku}`}>
                            <TableCell className="text-xs">{s.service}</TableCell>
                            <TableCell className="text-xs">{s.sku}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatEurDirect(s.costEur)}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {s.usageAmount != null
                                ? `${formatNumber(s.usageAmount)} ${s.usageUnit ?? ''}`.trim()
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
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
                <Euro className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatEur(data.summary.totalCostUsd)}</div>
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
                <div className="text-2xl font-bold">{formatEur(data.summary.avgCostPerArticle)}</div>
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
                  ({formatEur(data.budget.currentSpend)} / {formatEur(data.budget.budget)}).
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
                          {formatEur(row.cost)}
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
                          {formatEur(row.cost)}
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
                          {formatEur(article.totalCost)}
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

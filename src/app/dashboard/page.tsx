"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  PenLine,
  Globe,
  Loader2,
  DollarSign,
  RefreshCw,
  ArrowRight,
  Rocket,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Layers,
  TrendingUp,
  Zap,
  BarChart3,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ArticleStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/articles/status-badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface DashboardData {
  counts: {
    published: number;
    pipeline: number;
    refreshNeeded: number;
    draftWp: number;
    sites: number;
  };
  cost: {
    monthTotal: number;
    budget: number;
    budgetPercent: number;
    avgPerArticle: number;
    tokensIn: number;
    tokensOut: number;
    successRate: number;
    totalRuns: number;
  };
  top3Articles: { id: string; keyword: string; cost: number }[];
  recentArticles: {
    id: string;
    keyword: string;
    title: string | null;
    status: string;
    updated_at: string;
  }[];
  activeArticles: {
    id: string;
    keyword: string;
    status: string;
    updated_at: string;
  }[];
  draftWpList: {
    id: string;
    keyword: string;
    title: string | null;
    wp_url: string | null;
  }[];
}

const EMPTY_DATA: DashboardData = {
  counts: { published: 0, pipeline: 0, refreshNeeded: 0, draftWp: 0, sites: 0 },
  cost: { monthTotal: 0, budget: 50, budgetPercent: 0, avgPerArticle: 0, tokensIn: 0, tokensOut: 0, successRate: 100, totalRuns: 0 },
  top3Articles: [],
  recentArticles: [],
  activeArticles: [],
  draftWpList: [],
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleRefreshScan() {
    try {
      const sitesRes = await fetch("/api/sites");
      if (!sitesRes.ok) return;
      const sites = await sitesRes.json();
      if (!Array.isArray(sites) || sites.length === 0) return;

      let totalMarked = 0;
      for (const site of sites) {
        const res = await fetch("/api/articles/refresh-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site_id: site.id, auto_mark: true }),
        });
        if (res.ok) {
          const d = await res.json();
          totalMarked += d.marked || 0;
        }
      }

      toast({
        title: "Scan termine",
        description: `${totalMarked} article(s) marque(s) pour mise a jour.`,
      });
      fetchData();
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de lancer le scan." });
    }
  }

  const Loader = () => <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const budgetColor =
    data.cost.budgetPercent >= 80
      ? "text-red-600"
      : data.cost.budgetPercent >= 50
        ? "text-amber-600"
        : "text-emerald-600";

  const budgetBarColor =
    data.cost.budgetPercent >= 80
      ? "[&>div]:bg-red-500"
      : data.cost.budgetPercent >= 50
        ? "[&>div]:bg-amber-500"
        : "[&>div]:bg-emerald-500";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Vue d&apos;ensemble de votre production SEO</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefreshScan}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Scanner refreshs
          </Button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/dashboard/articles/new">
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Nouvel article
          </Button>
        </Link>
        <Link href="/dashboard/articles/batch">
          <Button variant="outline" size="sm">
            <Layers className="mr-2 h-4 w-4" />
            Batch
          </Button>
        </Link>
        <Link href="/dashboard/analytics">
          <Button variant="outline" size="sm">
            <BarChart3 className="mr-2 h-4 w-4" />
            Analytics
          </Button>
        </Link>
      </div>

      {/* Alert: articles en brouillon WP */}
      {data.counts.draftWp > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                {data.counts.draftWp} article{data.counts.draftWp > 1 ? "s" : ""} en brouillon WordPress
              </p>
              <p className="text-xs text-amber-600">
                Publie{data.counts.draftWp > 1 ? "s" : ""} dans le pipeline mais pas encore en ligne. Cliquez &quot;Mettre en ligne + Indexer&quot; pour les activer.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Articles publies */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Articles publies</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : <div className="text-2xl font-bold">{data.counts.published}</div>}
            <p className="text-xs text-muted-foreground">Total publie sur WordPress</p>
          </CardContent>
        </Card>

        {/* Pipeline en cours */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En cours</CardTitle>
            <PenLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : <div className="text-2xl font-bold">{data.counts.pipeline}</div>}
            <p className="text-xs text-muted-foreground">Articles dans le pipeline</p>
          </CardContent>
        </Card>

        {/* Sites actifs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sites actifs</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : <div className="text-2xl font-bold">{data.counts.sites}</div>}
            <p className="text-xs text-muted-foreground">WordPress connectes</p>
          </CardContent>
        </Card>

        {/* A rafraichir */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">A rafraichir</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : (
              <div className="text-2xl font-bold">
                {data.counts.refreshNeeded}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Articles a mettre a jour</p>
          </CardContent>
        </Card>
      </div>

      {/* Cost + Performance row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Cout du mois */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Cout du mois
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <Loader /> : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${budgetColor}`}>
                    ${data.cost.monthTotal.toFixed(2)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / ${data.cost.budget}
                  </span>
                </div>
                <Progress value={Math.min(data.cost.budgetPercent, 100)} className={`h-2 ${budgetBarColor}`} />
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">${data.cost.avgPerArticle.toFixed(2)}</span> / article
                  </div>
                  <div>
                    <span className="font-medium text-foreground">{data.cost.totalRuns}</span> runs ce mois
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Taux de reussite */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Taux de reussite pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <Loader /> : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${data.cost.successRate >= 90 ? "text-emerald-600" : data.cost.successRate >= 70 ? "text-amber-600" : "text-red-600"}`}>
                    {data.cost.successRate}%
                  </span>
                  {data.cost.successRate >= 90 && (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.cost.totalRuns > 0
                    ? `${Math.round((data.cost.successRate / 100) * data.cost.totalRuns)} succes sur ${data.cost.totalRuns} runs`
                    : "Aucun run ce mois"
                  }
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">{(data.cost.tokensIn / 1000).toFixed(0)}k</span> tokens in
                  </div>
                  <div>
                    <span className="font-medium text-foreground">{(data.cost.tokensOut / 1000).toFixed(0)}k</span> tokens out
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Top 3 articles les plus chers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top 3 articles les plus chers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : data.top3Articles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun cout enregistre</p>
            ) : (
              <div className="space-y-2.5">
                {data.top3Articles.map((article, i) => (
                  <Link
                    key={article.id}
                    href={`/dashboard/articles/${article.id}`}
                    className="flex items-center justify-between gap-2 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}.</span>
                      <span className="text-sm truncate group-hover:text-primary transition-colors">
                        {article.keyword}
                      </span>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono">
                      ${article.cost.toFixed(2)}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Draft WP articles */}
      {data.draftWpList.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Rocket className="h-4 w-4 text-amber-600" />
                A mettre en ligne
              </CardTitle>
              <CardDescription>Articles publies dans le pipeline, encore en brouillon WordPress</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.draftWpList.map((article) => (
                <Link
                  key={article.id}
                  href={`/dashboard/articles/${article.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{article.keyword}</p>
                    {article.title && (
                      <p className="text-xs text-muted-foreground truncate">{article.title}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 text-amber-600 border-amber-300 hover:bg-amber-50">
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                    Mettre en ligne
                  </Button>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom row: Recent + Pipeline */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent articles */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Articles recents</CardTitle>
            <Link href="/dashboard/articles">
              <Button variant="ghost" size="sm">
                Voir tout
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : data.recentArticles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun article pour le moment.</p>
            ) : (
              <div className="space-y-2">
                {data.recentArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={`/dashboard/articles/${article.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{article.keyword}</p>
                      {article.title && (
                        <p className="text-xs text-muted-foreground truncate">{article.title}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={article.status as ArticleStatus} />
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(article.updated_at), { addSuffix: true, locale: fr })}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active pipeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline en cours</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Loader /> : data.activeArticles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun article en cours de traitement.</p>
            ) : (
              <div className="space-y-2">
                {data.activeArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={`/dashboard/articles/${article.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-sm font-medium truncate min-w-0 flex-1">{article.keyword}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={article.status as ArticleStatus} />
                      <Badge variant="outline" className="text-xs">
                        {formatDistanceToNow(new Date(article.updated_at), { addSuffix: true, locale: fr })}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

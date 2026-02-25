"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  PenLine,
  Globe,
  Gem,
  Loader2,
  DollarSign,
  RefreshCw,
  Compass,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ArticleStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/articles/status-badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface DashboardStats {
  publishedCount: number;
  writingCount: number;
  refreshNeededCount: number;
  sitesCount: number;
  nuggetsCount: number;
  discoverNewCount: number;
  monthlyCost: number;
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
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    publishedCount: 0,
    writingCount: 0,
    refreshNeededCount: 0,
    sitesCount: 0,
    nuggetsCount: 0,
    discoverNewCount: 0,
    monthlyCost: 0,
    recentArticles: [],
    activeArticles: [],
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [sitesRes, articlesRes, nuggetsRes, discoverRes, analyticsRes] =
        await Promise.all([
          fetch("/api/sites"),
          fetch("/api/articles"),
          fetch("/api/nuggets"),
          fetch("/api/discover?status=new"),
          fetch("/api/analytics?period=month"),
        ]);

      let sitesCount = 0;
      let publishedCount = 0;
      let writingCount = 0;
      let refreshNeededCount = 0;
      let nuggetsCount = 0;
      let discoverNewCount = 0;
      let monthlyCost = 0;
      let recentArticles: DashboardStats["recentArticles"] = [];
      let activeArticles: DashboardStats["activeArticles"] = [];

      if (sitesRes.ok) {
        const sites = await sitesRes.json();
        sitesCount = Array.isArray(sites)
          ? sites.filter((s: { active?: boolean }) => s.active !== false).length
          : 0;
      }

      if (articlesRes.ok) {
        const articles = await articlesRes.json();
        if (Array.isArray(articles)) {
          const activeStatuses = [
            "analyzing",
            "planning",
            "writing",
            "media",
            "seo_check",
            "reviewing",
            "publishing",
          ];
          publishedCount = articles.filter(
            (a: { status: string }) => a.status === "published"
          ).length;
          writingCount = articles.filter((a: { status: string }) =>
            activeStatuses.includes(a.status)
          ).length;
          refreshNeededCount = articles.filter(
            (a: { status: string }) => a.status === "refresh_needed"
          ).length;

          // Recent articles (last 5 by updated_at)
          recentArticles = articles
            .sort(
              (
                a: { updated_at: string },
                b: { updated_at: string }
              ) =>
                new Date(b.updated_at).getTime() -
                new Date(a.updated_at).getTime()
            )
            .slice(0, 5)
            .map(
              (a: {
                id: string;
                keyword: string;
                title: string | null;
                status: string;
                updated_at: string;
              }) => ({
                id: a.id,
                keyword: a.keyword,
                title: a.title,
                status: a.status,
                updated_at: a.updated_at,
              })
            );

          // Active pipeline articles
          activeArticles = articles
            .filter((a: { status: string }) =>
              activeStatuses.includes(a.status)
            )
            .slice(0, 10)
            .map(
              (a: {
                id: string;
                keyword: string;
                status: string;
                updated_at: string;
              }) => ({
                id: a.id,
                keyword: a.keyword,
                status: a.status,
                updated_at: a.updated_at,
              })
            );
        }
      }

      if (nuggetsRes.ok) {
        const nuggets = await nuggetsRes.json();
        nuggetsCount = Array.isArray(nuggets) ? nuggets.length : 0;
      }

      if (discoverRes.ok) {
        const discover = await discoverRes.json();
        discoverNewCount = Array.isArray(discover) ? discover.length : 0;
      }

      if (analyticsRes.ok) {
        const analytics = await analyticsRes.json();
        monthlyCost = analytics?.summary?.totalCostUsd ?? 0;
      }

      setStats({
        publishedCount,
        writingCount,
        refreshNeededCount,
        sitesCount,
        nuggetsCount,
        discoverNewCount,
        monthlyCost,
        recentArticles,
        activeArticles,
      });
    } catch {
      // Keep default zeros
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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
          const data = await res.json();
          totalMarked += data.marked || 0;
        }
      }

      toast({
        title: "Scan termine",
        description: `${totalMarked} article(s) marque(s) pour mise a jour.`,
      });
      fetchStats();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de lancer le scan.",
      });
    }
  }

  const statCards = [
    {
      title: "Articles publies",
      value: stats.publishedCount,
      icon: FileText,
      description: "Total des articles publies",
    },
    {
      title: "En cours",
      value: stats.writingCount,
      icon: PenLine,
      description: "Articles dans le pipeline",
    },
    {
      title: "Sites actifs",
      value: stats.sitesCount,
      icon: Globe,
      description: "Sites WordPress connectes",
    },
    {
      title: "Nuggets",
      value: stats.nuggetsCount,
      icon: Gem,
      description: "Nuggets disponibles",
    },
    {
      title: "Cout du mois",
      value: `$${stats.monthlyCost.toFixed(2)}`,
      icon: DollarSign,
      description: "Depenses IA ce mois",
    },
    {
      title: "A rafraichir",
      value: stats.refreshNeededCount,
      icon: RefreshCw,
      description: "Articles a mettre a jour",
    },
    {
      title: "Discover",
      value: stats.discoverNewCount,
      icon: Compass,
      description: "Nouveaux sujets",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Vue d&apos;ensemble
          </h2>
          <p className="text-muted-foreground">
            Bienvenue dans SEO Content Studio.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshScan}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Scanner les refreshs
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <div className="text-2xl font-bold">{stat.value}</div>
              )}
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

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
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : stats.recentArticles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun article pour le moment.
              </p>
            ) : (
              <div className="space-y-3">
                {stats.recentArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={`/dashboard/articles/${article.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {article.keyword}
                      </p>
                      {article.title && (
                        <p className="text-xs text-muted-foreground truncate">
                          {article.title}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={article.status as ArticleStatus} />
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(article.updated_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
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
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : stats.activeArticles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun article en cours de traitement.
              </p>
            ) : (
              <div className="space-y-3">
                {stats.activeArticles.map((article) => (
                  <Link
                    key={article.id}
                    href={`/dashboard/articles/${article.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-sm font-medium truncate min-w-0 flex-1">
                      {article.keyword}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={article.status as ArticleStatus} />
                      <Badge variant="outline" className="text-xs">
                        {formatDistanceToNow(new Date(article.updated_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
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

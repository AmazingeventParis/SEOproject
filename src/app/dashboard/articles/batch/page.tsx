"use client";

import React, { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import type { Article, ArticleStatus, Site } from "@/lib/supabase/types";
import { getStatusLabel } from "@/lib/pipeline/state-machine";
import { StatusBadge } from "@/components/articles/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  Search,
  Square,
  XCircle,
} from "lucide-react";

interface ArticleWithRelations extends Article {
  seo_sites: { name: string; domain: string } | null;
  seo_personas: { name: string } | null;
}

// Statuses eligible for batch processing (need pipeline work)
const BATCH_ELIGIBLE_STATUSES: ArticleStatus[] = [
  "draft",
  "analyzing",
  "planning",
  "writing",
  "media",
  "seo_check",
];

interface ArticleProgress {
  status: "pending" | "running" | "success" | "error";
  stepsCompleted?: string[];
  error?: string;
}

export default function BatchPage() {
  const [articles, setArticles] = useState<ArticleWithRelations[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Queue processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMap, setProgressMap] = useState<Map<string, ArticleProgress>>(new Map());
  const [queueStats, setQueueStats] = useState<{ total: number; succeeded: number; failed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) setSites(await res.json());
    } catch { /* silent */ }
  }, []);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterSiteId) params.set("site_id", filterSiteId);
    if (filterStatus) params.set("status", filterStatus);
    if (filterSearch.trim()) params.set("search", filterSearch.trim());

    try {
      const res = await fetch(`/api/articles?${params.toString()}`);
      if (!res.ok) throw new Error();
      const data: ArticleWithRelations[] = await res.json();
      // Only show articles eligible for batch processing
      setArticles(data.filter(a => BATCH_ELIGIBLE_STATUSES.includes(a.status as ArticleStatus)));
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de charger les articles." });
    }
    setLoading(false);
  }, [filterSiteId, filterStatus, filterSearch, toast]);

  useEffect(() => { fetchSites(); }, [fetchSites]);
  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === articles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(articles.map(a => a.id)));
    }
  };

  // Launch batch processing
  const launchBatch = async () => {
    if (selectedIds.size === 0) return;

    const articleIds = Array.from(selectedIds);
    setIsProcessing(true);
    setQueueStats(null);

    // Initialize progress map
    const initial = new Map<string, ArticleProgress>();
    for (const id of articleIds) {
      initial.set(id, { status: "pending" });
    }
    setProgressMap(initial);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/articles/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleIds,
          concurrency: 2,
          autoSelectTitle: 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Erreur de lancement");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(eventType, data);
            } catch { /* ignore parse errors */ }
            eventType = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({ variant: "destructive", title: "Erreur", description: "Erreur durant le traitement batch." });
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  };

  const handleSSEEvent = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "article_start":
        setProgressMap(prev => {
          const next = new Map(prev);
          next.set(data.articleId as string, { status: "running" });
          return next;
        });
        break;

      case "article_done":
        setProgressMap(prev => {
          const next = new Map(prev);
          next.set(data.articleId as string, {
            status: data.success ? "success" : "error",
            stepsCompleted: data.stepsCompleted as string[] | undefined,
            error: data.error as string | undefined,
          });
          return next;
        });
        break;

      case "done":
        setQueueStats({
          total: data.totalArticles as number,
          succeeded: data.succeeded as number,
          failed: data.failed as number,
        });
        break;
    }
  };

  const stopBatch = () => {
    abortRef.current?.abort();
  };

  // Computed
  const completedCount = Array.from(progressMap.values()).filter(p => p.status === "success" || p.status === "error").length;
  const totalInQueue = progressMap.size;
  const overallProgress = totalInQueue > 0 ? Math.round((completedCount / totalInQueue) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/articles">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Production en lot</h2>
            <p className="text-muted-foreground">
              Selectionnez les articles a traiter en parallele.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Button variant="destructive" onClick={stopBatch}>
              <Square className="mr-2 h-4 w-4" />
              Arreter
            </Button>
          ) : (
            <Button
              onClick={launchBatch}
              disabled={selectedIds.size === 0}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <Play className="mr-2 h-4 w-4" />
              Lancer {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </Button>
          )}
        </div>
      </div>

      {/* Overall progress bar (shown during processing) */}
      {isProcessing && totalInQueue > 0 && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              Progression globale : {completedCount}/{totalInQueue} articles
            </span>
            <span className="text-muted-foreground">{overallProgress}%</span>
          </div>
          <Progress value={overallProgress} />
        </div>
      )}

      {/* Queue results */}
      {queueStats && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium">Traitement termine</p>
              <p className="text-sm text-muted-foreground">
                {queueStats.succeeded} reussi{queueStats.succeeded > 1 ? "s" : ""}
                {queueStats.failed > 0 && (
                  <span className="text-red-600"> — {queueStats.failed} echoue{queueStats.failed > 1 ? "s" : ""}</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {!isProcessing && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher par mot-cle..."
              className="pl-9"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
          </div>
          <Select
            value={filterSiteId || "__all__"}
            onValueChange={(value) => setFilterSiteId(value === "__all__" ? "" : value)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tous les sites" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tous les sites</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterStatus || "__all__"}
            onValueChange={(value) => setFilterStatus(value === "__all__" ? "" : value)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tous les statuts</SelectItem>
              {BATCH_ELIGIBLE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>{getStatusLabel(status)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Articles list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-muted-foreground">Aucun article eligible pour le traitement en lot.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Seuls les articles en cours de creation (draft → seo_check) sont affichés.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select all */}
          {!isProcessing && (
            <div className="flex items-center gap-3 px-2 py-1">
              <input
                type="checkbox"
                checked={selectedIds.size === articles.length && articles.length > 0}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
              />
              <span className="text-sm text-muted-foreground">
                {selectedIds.size === 0
                  ? "Tout selectionner"
                  : `${selectedIds.size} selectionne${selectedIds.size > 1 ? "s" : ""}`}
              </span>
            </div>
          )}

          {/* Article cards */}
          {articles.map((article) => {
            const progress = progressMap.get(article.id);
            const isSelected = selectedIds.has(article.id);

            return (
              <div
                key={article.id}
                className={`flex items-center gap-4 rounded-lg border p-4 transition-colors ${
                  isSelected ? "border-violet-300 bg-violet-50/50" : ""
                } ${progress?.status === "success" ? "border-green-300 bg-green-50/30" : ""}
                  ${progress?.status === "error" ? "border-red-300 bg-red-50/30" : ""}
                  ${progress?.status === "running" ? "border-blue-300 bg-blue-50/30" : ""}`}
              >
                {/* Checkbox */}
                {!isProcessing && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(article.id)}
                    className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer shrink-0"
                  />
                )}

                {/* Status icon during processing */}
                {isProcessing && progress && (
                  <div className="shrink-0">
                    {progress.status === "pending" && (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                    {progress.status === "running" && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    )}
                    {progress.status === "success" && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                    {progress.status === "error" && (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                  </div>
                )}

                {/* Article info */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={article.status} />
                    {article.seo_sites && (
                      <Badge variant="secondary" className="text-xs">
                        {article.seo_sites.name}
                      </Badge>
                    )}
                    {article.seo_personas && (
                      <span className="text-xs text-muted-foreground">
                        {article.seo_personas.name}
                      </span>
                    )}
                    {!article.persona_id && (
                      <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                        Pas de persona
                      </Badge>
                    )}
                  </div>
                  <p className="font-medium">{article.keyword}</p>
                  {article.title && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{article.title}</p>
                  )}

                  {/* Error message */}
                  {progress?.status === "error" && progress.error && (
                    <p className="text-xs text-red-600 mt-1">{progress.error}</p>
                  )}

                  {/* Steps completed */}
                  {progress?.status === "success" && progress.stepsCompleted && progress.stepsCompleted.length > 0 && (
                    <p className="text-xs text-green-700 mt-1">
                      Etapes : {progress.stepsCompleted.join(" → ")}
                    </p>
                  )}
                </div>

                {/* Link to article */}
                <Link
                  href={`/dashboard/articles/${article.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  Voir
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

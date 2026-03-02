"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Article, ArticleStatus, Site } from "@/lib/supabase/types";
import { getStatusLabel } from "@/lib/pipeline/state-machine";
import { StatusBadge } from "@/components/articles/status-badge";
import { PipelineProgress } from "@/components/articles/pipeline-progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileText, Loader2, Plus, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface ArticleWithRelations extends Article {
  seo_sites: { name: string; domain: string } | null;
  seo_personas: { name: string } | null;
}

const ALL_STATUSES: ArticleStatus[] = [
  "draft",
  "analyzing",
  "planning",
  "writing",
  "media",
  "seo_check",
  "reviewing",
  "publishing",
  "published",
  "refresh_needed",
];

export default function ArticlesPage() {
  const [articles, setArticles] = useState<ArticleWithRelations[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSites(data);
      }
    } catch {
      // silent fail
    }
  }, []);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterSiteId) params.set("site_id", filterSiteId);
    if (filterStatus) params.set("status", filterStatus);
    if (filterSearch.trim()) params.set("search", filterSearch.trim());

    try {
      const res = await fetch(`/api/articles?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Erreur lors du chargement");
      }
      const data = await res.json();
      setArticles(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les articles.",
      });
    }
    setLoading(false);
  }, [filterSiteId, filterStatus, filterSearch, toast]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Articles</h2>
          <p className="text-muted-foreground">
            Pipeline de production de contenu SEO.
          </p>
        </div>
        <Link href="/dashboard/articles/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nouvel article
          </Button>
        </Link>
      </div>

      {/* Filters */}
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
          onValueChange={(value) =>
            setFilterSiteId(value === "__all__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tous les sites" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous les sites</SelectItem>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>
                {site.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterStatus || "__all__"}
          onValueChange={(value) =>
            setFilterStatus(value === "__all__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous les statuts</SelectItem>
            {ALL_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <FileText className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Aucun article</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Commencez par creer votre premier article SEO.
          </p>
          <Link href="/dashboard/articles/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nouvel article
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((article) => {
            // Bande de couleur gauche selon la phase
            const phase =
              article.status === "draft"
                ? "border-l-gray-300"
                : article.status === "published"
                ? "border-l-green-500 bg-green-50/30"
                : article.status === "refresh_needed"
                ? "border-l-red-500 bg-red-50/30"
                : "border-l-blue-500"; // en cours de creation

            return (
            <Link
              key={article.id}
              href={`/dashboard/articles/${article.id}`}
              className="block"
            >
              <div className={`flex items-start gap-4 rounded-lg border border-l-4 ${phase} p-4 transition-colors hover:bg-muted/50 cursor-pointer`}>
                {/* Left: status + keyword */}
                <div className="min-w-0 flex-1 space-y-2">
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
                  </div>

                  <div>
                    <p className="font-semibold text-base">
                      {article.keyword}
                    </p>
                    {article.title && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {article.title}
                      </p>
                    )}
                  </div>

                  {/* Progress bar */}
                  <PipelineProgress status={article.status} />
                </div>

                {/* Right: meta info */}
                <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                  {article.word_count > 0 && (
                    <span className="text-sm font-medium">
                      {article.word_count.toLocaleString("fr-FR")} mots
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(article.updated_at), {
                      addSuffix: true,
                      locale: fr,
                    })}
                  </span>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

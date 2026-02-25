"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Site, Silo } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  Crown,
  FileText,
  Loader2,
  Network,
  Plus,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// Silo with joined site info and article count
interface SiloWithRelations extends Silo {
  seo_sites: { name: string } | null;
  article_count: number;
}

// Article info returned in silo detail
interface SiloArticle {
  id: string;
  keyword: string;
  title: string | null;
  status: string;
  slug: string | null;
}

// Silo link with article info
interface SiloLinkWithArticles {
  id: string;
  silo_id: string;
  source_article_id: string;
  target_article_id: string;
  anchor_text: string;
  is_bidirectional: boolean;
  created_at: string;
  source: { id: string; keyword: string; title: string | null } | null;
  target: { id: string; keyword: string; title: string | null } | null;
}

export default function SilosPage() {
  const [silos, setSilos] = useState<SiloWithRelations[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedSiloId, setExpandedSiloId] = useState<string | null>(null);
  const [expandedArticles, setExpandedArticles] = useState<SiloArticle[]>([]);
  const [expandedLinks, setExpandedLinks] = useState<SiloLinkWithArticles[]>([]);
  const [expandLoading, setExpandLoading] = useState(false);
  const { toast } = useToast();

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>("");

  // Create form state
  const [formName, setFormName] = useState("");
  const [formSiteId, setFormSiteId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [creating, setCreating] = useState(false);

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

  const fetchSilos = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterSiteId) params.set("site_id", filterSiteId);

    try {
      const res = await fetch(`/api/silos?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Erreur lors du chargement");
      }
      const data = await res.json();
      setSilos(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les silos.",
      });
    }
    setLoading(false);
  }, [filterSiteId, toast]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  useEffect(() => {
    fetchSilos();
  }, [fetchSilos]);

  async function handleCreate() {
    if (!formName.trim() || !formSiteId) return;

    setCreating(true);
    try {
      const res = await fetch("/api/silos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          site_id: formSiteId,
          description: formDescription.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Erreur lors de la creation");
      }

      toast({
        title: "Silo cree",
        description: `Le silo "${formName.trim()}" a ete cree.`,
      });
      setDialogOpen(false);
      setFormName("");
      setFormSiteId("");
      setFormDescription("");
      fetchSilos();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Impossible de creer le silo.";
      toast({
        variant: "destructive",
        title: "Erreur",
        description: message,
      });
    }
    setCreating(false);
  }

  async function handleDelete(silo: SiloWithRelations) {
    const confirmed = window.confirm(
      `Supprimer le silo "${silo.name}" ? Cette action est irreversible et supprimera tous les liens associes.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/silos/${silo.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Echec de la suppression");
      }
      toast({
        title: "Silo supprime",
        description: `Le silo "${silo.name}" a ete supprime.`,
      });
      if (expandedSiloId === silo.id) {
        setExpandedSiloId(null);
        setExpandedArticles([]);
        setExpandedLinks([]);
      }
      fetchSilos();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de supprimer le silo.",
      });
    }
  }

  async function toggleExpand(siloId: string) {
    if (expandedSiloId === siloId) {
      setExpandedSiloId(null);
      setExpandedArticles([]);
      setExpandedLinks([]);
      return;
    }

    setExpandedSiloId(siloId);
    setExpandLoading(true);

    try {
      const [siloRes, linksRes] = await Promise.all([
        fetch(`/api/silos/${siloId}`),
        fetch(`/api/silos/${siloId}/links`),
      ]);

      if (siloRes.ok) {
        const siloDetail = await siloRes.json();
        setExpandedArticles(siloDetail.articles ?? []);
      } else {
        setExpandedArticles([]);
      }

      if (linksRes.ok) {
        const linksData = await linksRes.json();
        setExpandedLinks(linksData);
      } else {
        setExpandedLinks([]);
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les details du silo.",
      });
      setExpandedArticles([]);
      setExpandedLinks([]);
    }

    setExpandLoading(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Silos</h2>
          <p className="text-muted-foreground">
            Structure de contenu et maillage interne.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau silo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Creer un nouveau silo</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="silo-name">
                  Nom du silo
                </label>
                <Input
                  id="silo-name"
                  placeholder="ex: Guide SEO Technique"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="silo-site">
                  Site
                </label>
                <Select value={formSiteId} onValueChange={setFormSiteId}>
                  <SelectTrigger id="silo-site">
                    <SelectValue placeholder="Choisir un site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="silo-desc">
                  Description (optionnelle)
                </label>
                <Textarea
                  id="silo-desc"
                  placeholder="Decrivez la thematique de ce silo..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={creating || !formName.trim() || !formSiteId}
                className="w-full"
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Creer le silo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
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
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : silos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Network className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Aucun silo</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Commencez par creer votre premier silo de contenu.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nouveau silo
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {silos.map((silo) => {
            const isExpanded = expandedSiloId === silo.id;
            return (
              <Card key={silo.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div
                      className="flex items-start gap-3 cursor-pointer flex-1"
                      onClick={() => toggleExpand(silo.id)}
                    >
                      <div className="mt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{silo.name}</CardTitle>
                        {silo.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {silo.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {silo.seo_sites && (
                            <Badge variant="secondary" className="text-xs">
                              {silo.seo_sites.name}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            <FileText className="mr-1 h-3 w-3" />
                            {silo.article_count} article
                            {silo.article_count !== 1 ? "s" : ""}
                          </Badge>
                          {silo.pillar_article_id && (
                            <Badge
                              variant="outline"
                              className="text-xs text-amber-600 border-amber-300"
                            >
                              <Crown className="mr-1 h-3 w-3" />
                              Article pilier
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(silo.created_at), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(silo)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                {/* Expanded content */}
                {isExpanded && (
                  <CardContent className="pt-0">
                    {expandLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Articles */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2">
                            Articles ({expandedArticles.length})
                          </h4>
                          {expandedArticles.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Aucun article dans ce silo.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {expandedArticles.map((article) => (
                                <div
                                  key={article.id}
                                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                >
                                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="font-medium truncate">
                                    {article.keyword}
                                  </span>
                                  {article.title && (
                                    <span className="text-muted-foreground truncate hidden sm:inline">
                                      - {article.title}
                                    </span>
                                  )}
                                  <Badge
                                    variant="outline"
                                    className="ml-auto text-xs shrink-0"
                                  >
                                    {article.status}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Links */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2">
                            Liens internes ({expandedLinks.length})
                          </h4>
                          {expandedLinks.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Aucun lien interne dans ce silo.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {expandedLinks.map((link) => (
                                <div
                                  key={link.id}
                                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                                >
                                  <Network className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="truncate">
                                    {link.source?.keyword ?? "?"}
                                  </span>
                                  <span className="text-muted-foreground shrink-0">
                                    {link.is_bidirectional ? "<->" : "->"}
                                  </span>
                                  <span className="truncate">
                                    {link.target?.keyword ?? "?"}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="ml-auto text-xs shrink-0"
                                  >
                                    {link.anchor_text}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

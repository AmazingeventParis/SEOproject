"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Nugget, Site } from "@/lib/supabase/types";
import { NuggetDialog } from "@/components/nuggets/nugget-dialog";
import { YoutubeImportDialog } from "@/components/nuggets/youtube-import-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Eye,
  Gem,
  Link,
  Loader2,
  MessageCircle,
  Mic,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Youtube,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// Nugget with joined site info
interface NuggetWithSite extends Nugget {
  seo_sites: { name: string; domain: string } | null;
}

const SOURCE_TYPE_OPTIONS = [
  { value: "vocal", label: "Vocal", icon: Mic },
  { value: "tweet", label: "Tweet", icon: MessageCircle },
  { value: "note", label: "Note", icon: StickyNote },
  { value: "url", label: "URL", icon: Link },
  { value: "observation", label: "Observation", icon: Eye },
  { value: "youtube", label: "YouTube", icon: Youtube },
] as const;

function getSourceIcon(sourceType: string) {
  const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === sourceType);
  if (!option) return StickyNote;
  return option.icon;
}

function getSourceLabel(sourceType: string) {
  const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === sourceType);
  return option?.label ?? sourceType;
}

export default function NuggetsPage() {
  const [nuggets, setNuggets] = useState<NuggetWithSite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [editingNugget, setEditingNugget] = useState<Nugget | undefined>(undefined);
  const { toast } = useToast();

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>("");
  const [filterSourceType, setFilterSourceType] = useState<string>("");
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

  const fetchNuggets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterSiteId) params.set("site_id", filterSiteId);
    if (filterSourceType) params.set("source_type", filterSourceType);
    if (filterSearch.trim()) params.set("search", filterSearch.trim());

    try {
      const res = await fetch(`/api/nuggets?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Erreur lors du chargement");
      }
      const data = await res.json();
      setNuggets(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les nuggets.",
      });
    }
    setLoading(false);
  }, [filterSiteId, filterSourceType, filterSearch, toast]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  useEffect(() => {
    fetchNuggets();
  }, [fetchNuggets]);

  function handleAdd() {
    setEditingNugget(undefined);
    setDialogOpen(true);
  }

  function handleEdit(nugget: Nugget) {
    setEditingNugget(nugget);
    setDialogOpen(true);
  }

  async function handleDelete(nugget: NuggetWithSite) {
    const confirmed = window.confirm(
      "Supprimer ce nugget ? Cette action est irreversible."
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/nuggets/${nugget.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Echec de la suppression");
      }
      toast({
        title: "Nugget supprime",
        description: "Le nugget a ete supprime.",
      });
      fetchNuggets();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de supprimer le nugget.",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Nuggets</h2>
          <p className="text-muted-foreground">
            Base de connaissances exclusives pour enrichir vos articles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setYoutubeDialogOpen(true)}>
            <Youtube className="mr-2 h-4 w-4 text-red-600" />
            Importer depuis YouTube
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un nugget
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher dans les nuggets..."
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
          value={filterSourceType || "__all__"}
          onValueChange={(value) =>
            setFilterSourceType(value === "__all__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tous les types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous les types</SelectItem>
            {SOURCE_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
      ) : nuggets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Gem className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Aucun nugget</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Commencez par ajouter votre premier nugget de connaissance.
          </p>
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un nugget
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {nuggets.map((nugget) => {
            const SourceIcon = getSourceIcon(nugget.source_type);
            return (
              <div
                key={nugget.id}
                className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                {/* Source icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <SourceIcon className="h-4 w-4 text-muted-foreground" />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm leading-relaxed line-clamp-3">
                    {nugget.content}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {getSourceLabel(nugget.source_type)}
                    </Badge>
                    {nugget.seo_sites && (
                      <Badge variant="secondary" className="text-xs">
                        {nugget.seo_sites.name}
                      </Badge>
                    )}
                    {nugget.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs font-normal">
                        {tag}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(nugget.created_at), {
                        addSuffix: true,
                        locale: fr,
                      })}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEdit(nugget)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(nugget)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog for create/edit */}
      <NuggetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        nugget={editingNugget}
        onSuccess={fetchNuggets}
      />

      {/* YouTube import dialog */}
      <YoutubeImportDialog
        open={youtubeDialogOpen}
        onOpenChange={setYoutubeDialogOpen}
        onSuccess={fetchNuggets}
      />
    </div>
  );
}

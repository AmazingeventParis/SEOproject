"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { Site, Persona, Silo, DiscoverItem } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Compass,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// Discover item with joined site info
interface DiscoverItemWithSite extends DiscoverItem {
  seo_sites: { name: string } | null;
}

const SOURCE_OPTIONS = [
  { value: "twitter", label: "Twitter", color: "bg-blue-100 text-blue-700" },
  { value: "trends", label: "Tendances", color: "bg-green-100 text-green-700" },
  { value: "serp", label: "SERP", color: "bg-amber-100 text-amber-700" },
  { value: "manual", label: "Manuel", color: "bg-gray-100 text-gray-700" },
] as const;

const STATUS_OPTIONS = [
  { value: "new", label: "Nouveau", color: "bg-blue-100 text-blue-700" },
  { value: "selected", label: "Selectionne", color: "bg-amber-100 text-amber-700" },
  { value: "converted", label: "Converti", color: "bg-green-100 text-green-700" },
  { value: "dismissed", label: "Ignore", color: "bg-gray-100 text-gray-700" },
] as const;

function getSourceOption(source: string) {
  return SOURCE_OPTIONS.find((o) => o.value === source);
}

function getStatusOption(status: string) {
  return STATUS_OPTIONS.find((o) => o.value === status);
}

export default function DiscoverPage() {
  const [items, setItems] = useState<DiscoverItemWithSite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertingItem, setConvertingItem] = useState<DiscoverItemWithSite | null>(null);
  const { toast } = useToast();

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  // Add form state
  const [addTopic, setAddTopic] = useState("");
  const [addSiteId, setAddSiteId] = useState("");
  const [addSource, setAddSource] = useState("manual");
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Convert form state
  const [convertPersonaId, setConvertPersonaId] = useState("");
  const [convertSiloId, setConvertSiloId] = useState("");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [silos, setSilos] = useState<Silo[]>([]);
  const [convertSubmitting, setConvertSubmitting] = useState(false);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data: Site[] = await res.json();
        setSites(data);
      }
    } catch {
      // silent fail
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterSiteId) params.set("site_id", filterSiteId);
    if (filterSource) params.set("source", filterSource);
    if (filterStatus) params.set("status", filterStatus);

    try {
      const res = await fetch(`/api/discover?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Erreur lors du chargement");
      }
      const data: DiscoverItemWithSite[] = await res.json();
      setItems(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger les sujets Discover.",
      });
    }
    setLoading(false);
  }, [filterSiteId, filterSource, filterStatus, toast]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Client-side search filter
  const filteredItems = filterSearch.trim()
    ? items.filter((item) =>
        item.topic.toLowerCase().includes(filterSearch.trim().toLowerCase())
      )
    : items;

  // ---- Add dialog ----
  function handleOpenAdd() {
    setAddTopic("");
    setAddSiteId("");
    setAddSource("manual");
    setAddDialogOpen(true);
  }

  async function handleSubmitAdd() {
    if (!addTopic.trim() || !addSiteId) return;
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: addTopic.trim(),
          site_id: addSiteId,
          source: addSource,
        }),
      });
      if (!res.ok) {
        throw new Error("Erreur lors de la creation");
      }
      toast({
        title: "Sujet ajoute",
        description: "Le sujet a ete ajoute a la liste Discover.",
      });
      setAddDialogOpen(false);
      fetchItems();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible d'ajouter le sujet.",
      });
    }
    setAddSubmitting(false);
  }

  // ---- Status update ----
  async function handleUpdateStatus(item: DiscoverItemWithSite, status: string) {
    try {
      const res = await fetch(`/api/discover/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        throw new Error("Erreur");
      }
      toast({
        title: "Statut mis a jour",
        description: `Le sujet a ete marque comme "${getStatusOption(status)?.label ?? status}".`,
      });
      fetchItems();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de mettre a jour le statut.",
      });
    }
  }

  // ---- Delete ----
  async function handleDelete(item: DiscoverItemWithSite) {
    const confirmed = window.confirm(
      "Supprimer ce sujet ? Cette action est irreversible."
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/discover/${item.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Echec de la suppression");
      }
      toast({
        title: "Sujet supprime",
        description: "Le sujet a ete supprime.",
      });
      fetchItems();
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de supprimer le sujet.",
      });
    }
  }

  // ---- Convert dialog ----
  function handleOpenConvert(item: DiscoverItemWithSite) {
    setConvertingItem(item);
    setConvertPersonaId("");
    setConvertSiloId("");
    setSilos([]);
    setConvertDialogOpen(true);

    // Fetch personas
    fetch("/api/personas")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Persona[]) => setPersonas(data))
      .catch(() => setPersonas([]));

    // Fetch silos for this item's site
    if (item.site_id) {
      fetch(`/api/silos?site_id=${item.site_id}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Silo[]) => setSilos(data))
        .catch(() => setSilos([]));
    }
  }

  async function handleSubmitConvert() {
    if (!convertingItem) return;
    setConvertSubmitting(true);
    try {
      const body: Record<string, string> = {};
      if (convertPersonaId) body.persona_id = convertPersonaId;
      if (convertSiloId) body.silo_id = convertSiloId;

      const res = await fetch(`/api/discover/${convertingItem.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error ?? "Erreur lors de la conversion"
        );
      }
      toast({
        title: "Converti en article",
        description: "Le sujet a ete converti en brouillon d'article.",
      });
      setConvertDialogOpen(false);
      setConvertingItem(null);
      fetchItems();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Impossible de convertir le sujet.",
      });
    }
    setConvertSubmitting(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Discover</h2>
          <p className="text-muted-foreground">
            Inbox de decouverte de sujets et tendances.
          </p>
        </div>
        <Button onClick={handleOpenAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un sujet
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un sujet..."
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
          value={filterSource || "__all__"}
          onValueChange={(value) =>
            setFilterSource(value === "__all__" ? "" : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Toutes les sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Toutes les sources</SelectItem>
            {SOURCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tous les statuts</SelectItem>
            {STATUS_OPTIONS.map((option) => (
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
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Compass className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Aucun sujet decouvert</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Commencez par ajouter votre premier sujet a explorer.
          </p>
          <Button onClick={handleOpenAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un sujet
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const sourceOpt = getSourceOption(item.source);
            const statusOpt = getStatusOption(item.status);
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                {/* Content */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-sm font-semibold leading-relaxed line-clamp-3">
                    {item.topic}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {sourceOpt && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${sourceOpt.color}`}
                      >
                        {sourceOpt.label}
                      </Badge>
                    )}
                    {item.seo_sites && (
                      <Badge variant="secondary" className="text-xs">
                        {item.seo_sites.name}
                      </Badge>
                    )}
                    {statusOpt && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${statusOpt.color}`}
                      >
                        {statusOpt.label}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.created_at), {
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
                    <DropdownMenuItem
                      onClick={() => handleOpenConvert(item)}
                      disabled={item.status === "converted"}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Convertir en article
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(item, "selected")}
                      disabled={item.status === "selected" || item.status === "converted"}
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Selectionner
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleUpdateStatus(item, "dismissed")}
                      disabled={item.status === "dismissed" || item.status === "converted"}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Ignorer
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(item)}
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

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un sujet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Sujet</label>
              <Textarea
                placeholder="Decrivez le sujet a explorer..."
                value={addTopic}
                onChange={(e) => setAddTopic(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Site</label>
              <Select value={addSiteId} onValueChange={setAddSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selectionner un site" />
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
              <label className="text-sm font-medium">Source</label>
              <Select value={addSource} onValueChange={setAddSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSubmitAdd}
              disabled={addSubmitting || !addTopic.trim() || !addSiteId}
              className="w-full"
            >
              {addSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Ajouter
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convertir en article</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 bg-muted/50">
              <p className="text-sm font-medium">{convertingItem?.topic}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Persona (optionnel)</label>
              <Select
                value={convertPersonaId || "__none__"}
                onValueChange={(value) =>
                  setConvertPersonaId(value === "__none__" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selectionner un persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun persona</SelectItem>
                  {personas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>
                      {persona.name} - {persona.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Silo (optionnel)</label>
              <Select
                value={convertSiloId || "__none__"}
                onValueChange={(value) =>
                  setConvertSiloId(value === "__none__" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selectionner un silo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Aucun silo</SelectItem>
                  {silos.map((silo) => (
                    <SelectItem key={silo.id} value={silo.id}>
                      {silo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSubmitConvert}
              disabled={convertSubmitting}
              className="w-full"
            >
              {convertSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Convertir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

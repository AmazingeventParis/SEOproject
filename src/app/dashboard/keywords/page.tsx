"use client";

import React, { useCallback, useEffect, useState, useRef } from "react";
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
import {
  Upload,
  Search,
  Loader2,
  ArrowUpDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Trash2,
  FileText,
  Target,
} from "lucide-react";

interface KeywordRow {
  id: string;
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  kgr: number | null;
  search_intent: string;
  priority_score: number;
  status: string;
  source: string;
  silo_id: string | null;
  import_batch: string | null;
  cannibalization_risk: {
    articleId: string;
    articleKeyword: string;
    articleTitle: string | null;
    similarity: string;
  } | null;
  current_position: number | null;
  created_at: string;
  seo_silos: { name: string } | null;
}

interface Site {
  id: string;
  name: string;
  domain: string;
  growth_phase: string;
}

interface Silo {
  id: string;
  name: string;
  site_id: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  selected: "bg-purple-100 text-purple-800",
  assigned: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-800",
  dismissed: "bg-gray-100 text-gray-500",
};

const INTENT_LABELS: Record<string, string> = {
  traffic: "Traffic",
  informational: "Info",
  review: "Review",
  comparison: "Comparatif",
  lead_gen: "Lead Gen",
  discover: "Discover",
  opinion: "Opinion",
};

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  sandbox: { label: "Sandbox", color: "bg-orange-100 text-orange-800" },
  authority: { label: "Autorite", color: "bg-blue-100 text-blue-800" },
  monetization: { label: "Monetisation", color: "bg-green-100 text-green-800" },
};

export default function KeywordsPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [silos, setSilos] = useState<Silo[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rescoring, setRescoring] = useState(false);

  // Filters
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [selectedSilo, setSelectedSilo] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("priority_score");
  const [sortOrder, setSortOrder] = useState("desc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Load sites
  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data) => {
        const s = Array.isArray(data) ? data : data.sites || [];
        setSites(s);
        if (s.length > 0 && !selectedSite) setSelectedSite(s[0].id);
      });
  }, []);

  // Load silos when site changes
  useEffect(() => {
    if (!selectedSite) return;
    fetch(`/api/silos?site_id=${selectedSite}`)
      .then((r) => r.json())
      .then((data) => setSilos(Array.isArray(data) ? data : data.silos || []));
  }, [selectedSite]);

  // Load keywords
  const fetchKeywords = useCallback(async () => {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ site_id: selectedSite, sort: sortField, order: sortOrder, limit: "200" });
      if (selectedSilo) params.set("silo_id", selectedSilo);
      if (selectedStatus) params.set("status", selectedStatus);
      const res = await fetch(`/api/keywords?${params}`);
      const data = await res.json();
      let kws = data.keywords || [];
      // Client-side search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        kws = kws.filter((k: KeywordRow) => k.keyword.includes(q));
      }
      setKeywords(kws);
      setTotal(data.total || kws.length);
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les mots-cles", variant: "destructive" });
    }
    setLoading(false);
  }, [selectedSite, selectedSilo, selectedStatus, sortField, sortOrder, searchQuery, toast]);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  // CSV Import
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSite) return;
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: text,
          site_id: selectedSite,
          silo_id: selectedSilo || null,
          batch_name: file.name.replace(/\.csv$/i, ""),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({
        title: "Import reussi",
        description: `${data.imported} mots-cles importes (${data.cannibalized} cannibalises). Phase: ${data.phase}`,
      });
      fetchKeywords();
    } catch (err) {
      toast({ title: "Erreur import", description: (err as Error).message, variant: "destructive" });
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Re-score
  const handleRescore = async () => {
    if (!selectedSite) return;
    setRescoring(true);
    try {
      const res = await fetch("/api/keywords", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rescore", site_id: selectedSite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: "Rescoring termine", description: `${data.rescored} mots-cles recalcules (phase: ${data.phase})` });
      fetchKeywords();
    } catch (err) {
      toast({ title: "Erreur", description: (err as Error).message, variant: "destructive" });
    }
    setRescoring(false);
  };

  // Bulk actions
  const handleBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    try {
      await fetch("/api/keywords", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      toast({ title: "Mis a jour", description: `${selectedIds.size} mots-cles → ${status}` });
      setSelectedIds(new Set());
      fetchKeywords();
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedIds.size} mots-cles ?`)) return;
    try {
      await fetch("/api/keywords", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      toast({ title: "Supprime", description: `${selectedIds.size} mots-cles supprimes` });
      setSelectedIds(new Set());
      fetchKeywords();
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleCreateArticle = (kw: KeywordRow) => {
    const params = new URLSearchParams({
      keyword: kw.keyword,
      site_id: selectedSite,
      search_intent: kw.search_intent,
    });
    if (kw.silo_id) params.set("silo_id", kw.silo_id);
    window.location.href = `/dashboard/articles/new?${params}`;
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === keywords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(keywords.map((k) => k.id)));
    }
  };

  const currentSite = sites.find((s) => s.id === selectedSite);
  const phaseInfo = currentSite ? PHASE_LABELS[currentSite.growth_phase] || PHASE_LABELS.sandbox : null;

  const getPriorityColor = (score: number) => {
    if (score >= 70) return "text-green-700 bg-green-50 font-bold";
    if (score >= 50) return "text-blue-700 bg-blue-50";
    if (score >= 30) return "text-amber-700 bg-amber-50";
    return "text-gray-500 bg-gray-50";
  };

  const getDifficultyColor = (kd: number) => {
    if (kd <= 20) return "text-green-700";
    if (kd <= 40) return "text-blue-700";
    if (kd <= 60) return "text-amber-700";
    return "text-red-700";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recherche de mots-cles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} mot(s)-cle(s) au total
            {phaseInfo && (
              <Badge className={`ml-2 ${phaseInfo.color}`}>{phaseInfo.label}</Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCsvUpload}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing || !selectedSite}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            Importer CSV
          </Button>
          <Button variant="outline" onClick={handleRescore} disabled={rescoring || !selectedSite}>
            {rescoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Recalculer scores
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={selectedSite} onValueChange={setSelectedSite}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Site" />
          </SelectTrigger>
          <SelectContent>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedSilo || "all"} onValueChange={(v) => setSelectedSilo(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Silo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les silos</SelectItem>
            {silos.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedStatus || "all"} onValueChange={(v) => setSelectedStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="new">Nouveau</SelectItem>
            <SelectItem value="selected">Selectionne</SelectItem>
            <SelectItem value="assigned">Assigne</SelectItem>
            <SelectItem value="done">Termine</SelectItem>
            <SelectItem value="dismissed">Ecarte</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filtrer par mot-cle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selectionne(s)</span>
          <Button size="sm" variant="outline" onClick={() => handleBulkStatus("selected")}>
            <Target className="h-3 w-3 mr-1" /> Selectionner
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleBulkStatus("dismissed")}>
            Ecarter
          </Button>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
            <Trash2 className="h-3 w-3 mr-1" /> Supprimer
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.size === keywords.length && keywords.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="p-3 text-left cursor-pointer hover:bg-muted" onClick={() => toggleSort("priority_score")}>
                <div className="flex items-center gap-1">Score <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-3 text-left cursor-pointer hover:bg-muted" onClick={() => toggleSort("keyword")}>
                Mot-cle
              </th>
              <th className="p-3 text-right cursor-pointer hover:bg-muted" onClick={() => toggleSort("volume")}>
                <div className="flex items-center gap-1 justify-end">Vol. <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-3 text-right cursor-pointer hover:bg-muted" onClick={() => toggleSort("difficulty")}>
                <div className="flex items-center gap-1 justify-end">KD <ArrowUpDown className="h-3 w-3" /></div>
              </th>
              <th className="p-3 text-right">CPC</th>
              <th className="p-3 text-center">Intent</th>
              <th className="p-3 text-center">Silo</th>
              <th className="p-3 text-center">Statut</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  Chargement...
                </td>
              </tr>
            ) : keywords.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-muted-foreground">
                  Aucun mot-cle. Importez un CSV Semrush pour commencer.
                </td>
              </tr>
            ) : (
              keywords.map((kw) => (
                <tr key={kw.id} className={`border-t hover:bg-muted/30 ${kw.cannibalization_risk ? "bg-red-50/50" : ""}`}>
                  <td className="p-3">
                    <input type="checkbox" checked={selectedIds.has(kw.id)} onChange={() => toggleSelect(kw.id)} />
                  </td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-mono ${getPriorityColor(kw.priority_score)}`}>
                      {kw.priority_score}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{kw.keyword}</div>
                    {kw.cannibalization_risk && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        Cannib. {kw.cannibalization_risk.similarity} avec &quot;{kw.cannibalization_risk.articleKeyword}&quot;
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono">{kw.volume.toLocaleString()}</td>
                  <td className={`p-3 text-right font-mono ${getDifficultyColor(kw.difficulty)}`}>
                    {kw.difficulty}
                  </td>
                  <td className="p-3 text-right font-mono">{kw.cpc > 0 ? `${kw.cpc}€` : "-"}</td>
                  <td className="p-3 text-center">
                    <Badge variant="outline" className="text-xs">
                      {INTENT_LABELS[kw.search_intent] || kw.search_intent}
                    </Badge>
                  </td>
                  <td className="p-3 text-center text-xs text-muted-foreground">
                    {kw.seo_silos?.name || "-"}
                  </td>
                  <td className="p-3 text-center">
                    <Badge className={`text-xs ${STATUS_COLORS[kw.status] || ""}`}>
                      {kw.status}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      {kw.status !== "done" && !kw.cannibalization_risk && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleCreateArticle(kw)}
                          title="Creer un article"
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          Article
                        </Button>
                      )}
                      {kw.status === "new" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-green-700"
                          onClick={() => {
                            handleBulkStatus("selected");
                            setSelectedIds(new Set([kw.id]));
                          }}
                        >
                          <CheckCircle className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

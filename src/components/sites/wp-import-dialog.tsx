"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Download, Globe, Loader2 } from "lucide-react";
import type { Persona, Silo } from "@/lib/supabase/types";
import { getBrowserClient } from "@/lib/supabase/client";

type DialogStep = "loading" | "select" | "importing" | "done";

interface WpPost {
  id: number;
  title: string;
  slug: string;
  link: string;
}

interface ImportResult {
  wp_post_id: number;
  article_id?: string;
  error?: string;
}

interface WpImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  onSuccess: () => void;
}

export function WpImportDialog({
  open,
  onOpenChange,
  siteId,
  onSuccess,
}: WpImportDialogProps) {
  const [step, setStep] = useState<DialogStep>("loading");
  const [posts, setPosts] = useState<WpPost[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [silos, setSilos] = useState<Silo[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string>("");
  const [selectedSilo, setSelectedSilo] = useState<string>("");
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [alreadyImported, setAlreadyImported] = useState(0);

  const fetchData = useCallback(async () => {
    setStep("loading");
    setError("");
    try {
      // Fetch WP posts and personas/silos in parallel
      const [postsRes, supabase] = await Promise.all([
        fetch(`/api/sites/${siteId}/wp-posts`),
        Promise.resolve(getBrowserClient()),
      ]);

      if (!postsRes.ok) {
        const err = await postsRes.json();
        throw new Error(err.error || "Erreur de chargement");
      }

      const postsData = await postsRes.json();
      setPosts(postsData.available || []);
      setTotalAvailable(postsData.total || 0);
      setAlreadyImported(postsData.alreadyImported || 0);

      // Fetch personas (via pivot table) and silos for this site
      const [personaPivotRes, silosRes] = await Promise.all([
        supabase
          .from("seo_persona_sites")
          .select("persona_id, seo_personas(*)")
          .eq("site_id", siteId),
        supabase
          .from("seo_silos")
          .select("*")
          .eq("site_id", siteId)
          .order("name"),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pivotPersonas = (personaPivotRes.data || []).map((row: any) => row.seo_personas).filter(Boolean);
      setPersonas(pivotPersonas);
      setSilos(silosRes.data || []);
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setStep("select");
    }
  }, [siteId]);

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedIds(new Set());
      setSelectedPersona("");
      setSelectedSilo("");
      setImportResults([]);
    }
  }, [open, fetchData]);

  function togglePost(postId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === posts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(posts.map((p) => p.id)));
    }
  }

  async function handleImport() {
    if (selectedIds.size === 0) return;
    setStep("importing");
    setImportProgress(0);

    const postsToImport = Array.from(selectedIds).map((wp_post_id) => ({
      wp_post_id,
      persona_id: selectedPersona || null,
      silo_id: selectedSilo || null,
    }));

    try {
      const res = await fetch(`/api/sites/${siteId}/wp-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts: postsToImport }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur d'import");
      }

      const data = await res.json();
      setImportResults(data.results || []);
      setImportProgress(100);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setStep("done");
    }
  }

  const importedCount = importResults.filter((r) => r.article_id).length;
  const errorCount = importResults.filter((r) => r.error).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Importer depuis WordPress
          </DialogTitle>
          <DialogDescription>
            Selectionnez les articles WordPress a importer dans l&apos;outil SEO.
          </DialogDescription>
        </DialogHeader>

        {/* Loading */}
        {step === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">
              Chargement des posts WordPress...
            </span>
          </div>
        )}

        {/* Selection */}
        {step === "select" && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{totalAvailable} posts sur WordPress</span>
              <span>-</span>
              <span>{alreadyImported} deja importes</span>
              <span>-</span>
              <span className="font-medium text-foreground">
                {posts.length} disponibles
              </span>
            </div>

            {posts.length === 0 ? (
              <div className="rounded-lg border border-dashed py-8 text-center">
                <Globe className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Tous les posts WordPress sont deja importes.
                </p>
              </div>
            ) : (
              <>
                {/* Select all */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAll}
                  >
                    {selectedIds.size === posts.length
                      ? "Tout deselectionner"
                      : `Tout selectionner (${posts.length})`}
                  </Button>
                  <Badge variant="secondary">
                    {selectedIds.size} selectionne(s)
                  </Badge>
                </div>

                {/* Post list */}
                <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-lg border p-2">
                  {posts.map((post) => (
                    <label
                      key={post.id}
                      className={`flex items-start gap-3 rounded-md p-2 cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedIds.has(post.id) ? "bg-primary/5" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(post.id)}
                        onChange={() => togglePost(post.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight">
                          {post.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          /{post.slug}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Persona + Silo */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Persona (optionnel)
                    </label>
                    <Select
                      value={selectedPersona || "__none__"}
                      onValueChange={(v) =>
                        setSelectedPersona(v === "__none__" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Aucun" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Aucun</SelectItem>
                        {personas.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Silo (optionnel)
                    </label>
                    <Select
                      value={selectedSilo || "__none__"}
                      onValueChange={(v) =>
                        setSelectedSilo(v === "__none__" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Aucun" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Aucun</SelectItem>
                        {silos.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Import button */}
                <Button
                  onClick={handleImport}
                  disabled={selectedIds.size === 0}
                  className="w-full"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Importer {selectedIds.size} article(s)
                </Button>
              </>
            )}
          </div>
        )}

        {/* Importing */}
        {step === "importing" && (
          <div className="space-y-4 py-6">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">
                Import en cours... ({selectedIds.size} article(s))
              </p>
            </div>
            <Progress value={importProgress} />
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="space-y-4 py-4">
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
              <p className="mt-2 text-lg font-semibold">Import termine</p>
              <p className="text-sm text-muted-foreground">
                {importedCount} importe(s)
                {errorCount > 0 && `, ${errorCount} erreur(s)`}
              </p>
            </div>

            {/* Results details */}
            {importResults.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-lg border p-2">
                {importResults.map((r) => {
                  const post = posts.find((p) => p.id === r.wp_post_id);
                  return (
                    <div
                      key={r.wp_post_id}
                      className={`flex items-center gap-2 text-sm p-2 rounded ${
                        r.article_id
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {r.article_id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 text-center">!</span>
                      )}
                      <span className="truncate">
                        {post?.title || `Post #${r.wp_post_id}`}
                      </span>
                      {r.error && (
                        <span className="ml-auto text-xs opacity-70">
                          {r.error}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              onClick={() => {
                onOpenChange(false);
                if (importedCount > 0) onSuccess();
              }}
              className="w-full"
            >
              Fermer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

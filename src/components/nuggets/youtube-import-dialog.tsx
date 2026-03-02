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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Youtube } from "lucide-react";
import type { Site } from "@/lib/supabase/types";

type DialogStep = "input" | "loading" | "preview" | "saving" | "done";

interface ExtractedNugget {
  content: string;
  tags: string[];
  selected: boolean;
}

interface YoutubeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function YoutubeImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: YoutubeImportDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<DialogStep>("input");
  const [url, setUrl] = useState("");
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [extraTags, setExtraTags] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [nuggets, setNuggets] = useState<ExtractedNugget[]>([]);
  const [videoId, setVideoId] = useState("");
  const [savingProgress, setSavingProgress] = useState(0);
  const [savingTotal, setSavingTotal] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState("");

  // Fetch sites on mount
  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) setSites(await res.json());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (open) fetchSites();
  }, [open, fetchSites]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("input");
      setUrl("");
      setSelectedSiteIds([]);
      setExtraTags("");
      setNuggets([]);
      setVideoId("");
      setSavingProgress(0);
      setSavingTotal(0);
      setSavedCount(0);
      setError("");
    }
  }, [open]);

  // Step 1: Extract from YouTube
  async function handleExtract() {
    if (!url.trim()) return;
    setError("");
    setStep("loading");

    try {
      const res = await fetch("/api/nuggets/youtube-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur inconnue");
        setStep("input");
        return;
      }

      setVideoId(data.video_id);
      setNuggets(
        data.nuggets.map((n: { content: string; tags: string[] }) => ({
          ...n,
          selected: true,
        }))
      );
      setStep("preview");
    } catch {
      setError("Erreur reseau. Verifiez votre connexion.");
      setStep("input");
    }
  }

  // Toggle selection
  function toggleNugget(index: number) {
    setNuggets((prev) =>
      prev.map((n, i) => (i === index ? { ...n, selected: !n.selected } : n))
    );
  }

  function toggleAll() {
    const allSelected = nuggets.every((n) => n.selected);
    setNuggets((prev) => prev.map((n) => ({ ...n, selected: !allSelected })));
  }

  const selectedCount = nuggets.filter((n) => n.selected).length;

  function toggleSite(id: string) {
    setSelectedSiteIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  // Step 3: Save selected nuggets (one per site, or once with null if no site)
  async function handleSave() {
    const toSave = nuggets.filter((n) => n.selected);
    if (toSave.length === 0) return;

    const siteIds = selectedSiteIds.length > 0 ? selectedSiteIds : [null];
    const totalOps = toSave.length * siteIds.length;

    setStep("saving");
    setSavingTotal(totalOps);
    setSavingProgress(0);
    let saved = 0;

    const additionalTags = extraTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    for (const nugget of toSave) {
      for (const sId of siteIds) {
        try {
          const payload = {
            content: nugget.content,
            source_type: "youtube" as const,
            source_ref: `https://youtube.com/watch?v=${videoId}`,
            site_id: sId,
            persona_id: null,
            tags: [...nugget.tags, ...additionalTags],
          };

          const res = await fetch("/api/nuggets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (res.ok) saved++;
        } catch {
          // continue with next
        }
        setSavingProgress((prev) => prev + 1);
      }
    }

    setSavedCount(saved);
    setStep("done");
  }

  function handleClose() {
    if (step === "done") onSuccess();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={step === "saving" ? undefined : onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-600" />
            Importer depuis YouTube
          </DialogTitle>
          <DialogDescription>
            Extrayez automatiquement des nuggets depuis une video YouTube.
          </DialogDescription>
        </DialogHeader>

        {/* Step: Input */}
        {step === "input" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="yt-url">URL de la video YouTube</Label>
              <Input
                id="yt-url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleExtract()}
              />
            </div>

            <div className="space-y-2">
              <Label>Sites (optionnel)</Label>
              <div className="flex flex-wrap gap-2">
                {sites.map((s) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                      selectedSiteIds.includes(s.id)
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSiteIds.includes(s.id)}
                      onChange={() => toggleSite(s.id)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
              {sites.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun site configure.</p>
              )}
              {selectedSiteIds.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Chaque nugget sera duplique pour les {selectedSiteIds.length} sites selectionnes.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-tags">Tags supplementaires (optionnel)</Label>
              <Input
                id="extra-tags"
                placeholder="tag1, tag2, tag3"
                value={extraTags}
                onChange={(e) => setExtraTags(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separes par des virgules. S&apos;ajoutent aux tags extraits automatiquement.
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleExtract} disabled={!url.trim()}>
                <Youtube className="mr-2 h-4 w-4" />
                Extraire les nuggets
              </Button>
            </div>
          </div>
        )}

        {/* Step: Loading */}
        {step === "loading" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Analyse de la transcription en cours...
            </p>
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {nuggets.length} nuggets extraits — {selectedCount} selectionne{selectedCount > 1 ? "s" : ""}
              </p>
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {nuggets.every((n) => n.selected) ? "Tout deselectionner" : "Tout selectionner"}
              </Button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {nuggets.map((nugget, i) => (
                <label
                  key={i}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    nugget.selected ? "bg-primary/5 border-primary/30" : "opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={nugget.selected}
                    onChange={() => toggleNugget(i)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm leading-relaxed">{nugget.content}</p>
                    <div className="flex flex-wrap gap-1">
                      {nugget.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("input")}>
                Retour
              </Button>
              <Button onClick={handleSave} disabled={selectedCount === 0}>
                Importer {selectedCount} nugget{selectedCount > 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Saving */}
        {step === "saving" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sauvegarde {savingProgress}/{savingTotal} nuggets...
            </p>
            <Progress
              value={savingTotal > 0 ? (savingProgress / savingTotal) * 100 : 0}
              className="w-64"
            />
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="text-lg font-semibold">
              {savedCount} nugget{savedCount > 1 ? "s" : ""} importe{savedCount > 1 ? "s" : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              Les nuggets ont ete ajoutes a votre base de connaissances.
            </p>
            <Button onClick={handleClose}>Fermer</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

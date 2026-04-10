"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, CheckCircle, Globe, Sparkles } from "lucide-react";

interface CompetitorUrl {
  url: string;
  domain: string;
  title: string;
}

interface CsvSlot {
  url: string;
  domain: string;
  csvText: string | null;
  fileName: string | null;
  keywordsFound: number | null;
}

interface CompetitorCsvImportProps {
  articleId: string;
  competitors: CompetitorUrl[];
  onImportComplete: () => void;
  alreadyImported?: boolean;
}

export function CompetitorCsvImport({
  articleId,
  competitors,
  onImportComplete,
  alreadyImported,
}: CompetitorCsvImportProps) {
  const { toast } = useToast();
  const [slots, setSlots] = useState<CsvSlot[]>(
    competitors.slice(0, 5).map((c) => ({
      url: c.url,
      domain: c.domain,
      csvText: null,
      fileName: null,
      keywordsFound: null,
    }))
  );
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(alreadyImported || false);

  const handleFileChange = async (index: number, file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setSlots((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, csvText: text, fileName: file.name } : s
      )
    );
  };

  const handleImport = async () => {
    const csvTexts = slots
      .filter((s) => s.csvText)
      .map((s) => ({ url: s.url, csv: s.csvText! }));

    if (csvTexts.length === 0) {
      toast({ title: "Aucun CSV", description: "Uploadez au moins 1 CSV Semrush.", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/import-competitor-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvTexts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update slots with results
      if (data.imports) {
        setSlots((prev) =>
          prev.map((s) => {
            const result = data.imports.find((r: { url: string; keywordsFound: number }) => r.url === s.url);
            return result ? { ...s, keywordsFound: result.keywordsFound } : s;
          })
        );
      }

      setImported(true);
      toast({
        title: "Import reussi",
        description: `${data.totalKeywordsExtracted} mots-cles extraits → ${data.tfidfTerms} termes TF-IDF + ${data.semanticFieldTerms} termes semantiques`,
      });
      onImportComplete();
    } catch (err) {
      toast({ title: "Erreur import", description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const csvCount = slots.filter((s) => s.csvText).length;

  return (
    <Card className={imported ? "border-emerald-200 bg-emerald-50/30" : "border-blue-200 bg-blue-50/30"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-base">Redaction optimisee — CSV Semrush</CardTitle>
          </div>
          {imported && (
            <Badge className="bg-emerald-100 text-emerald-700">
              <CheckCircle className="h-3 w-3 mr-1" /> Importe
            </Badge>
          )}
        </div>
        <CardDescription>
          Optionnel : importez le CSV Semrush &quot;Organic Research&quot; de chaque concurrent pour enrichir la semantique.
          L&apos;IA utilisera ces mots-cles reels (avec volumes) pour mieux rediger.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {slots.map((slot, idx) => (
          <div key={idx} className="flex items-center gap-3 p-2 rounded-lg border bg-background">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-foreground" title={slot.url}>
                {slot.domain}
              </p>
              <p className="text-xs text-muted-foreground truncate">{slot.url}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {slot.keywordsFound !== null ? (
                <Badge variant="outline" className="text-xs">
                  {slot.keywordsFound} mots-cles
                </Badge>
              ) : slot.fileName ? (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                  {slot.fileName}
                </Badge>
              ) : (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => handleFileChange(idx, e.target.files?.[0] || null)}
                  />
                  <span className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1">
                    <Upload className="h-3 w-3" /> CSV
                  </span>
                </label>
              )}
            </div>
          </div>
        ))}

        {!imported && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              {csvCount === 0
                ? "Aucun CSV uploade — vous pouvez passer cette etape"
                : `${csvCount} CSV pret${csvCount > 1 ? "s" : ""} a importer`}
            </p>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing || csvCount === 0}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Importer les mots-cles
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

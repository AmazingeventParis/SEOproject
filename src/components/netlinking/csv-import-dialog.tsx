"use client";

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CsvImportDialogProps {
  opportunityId: string;
  vendorDomain: string;
  onImported: () => void;
}

export function CsvImportDialog({ opportunityId, vendorDomain, onImported }: CsvImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ keywords_imported: number; summary: Record<string, unknown> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      const csvContent = await file.text();

      const res = await fetch("/api/netlinking/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opportunityId,
          csv_content: csvContent,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur import");
      }

      const data = await res.json();
      setResult(data);
      toast({ title: `${data.keywords_imported} mots-cles importes` });
      onImported();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Upload className="w-3 h-3 mr-1" /> CSV</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Semrush CSV — {vendorDomain}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Exportez les mots-cles organiques depuis Semrush (Organic Research &gt; Positions) et importez le CSV ici.
          </p>
          <input
            type="file"
            ref={fileRef}
            accept=".csv,.tsv,.txt"
            onChange={handleFileUpload}
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer"
          />
          {loading && <p className="text-sm text-blue-600">Import en cours...</p>}
          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm space-y-2">
              <p className="font-semibold text-green-800">{result.keywords_imported} mots-cles importes</p>
              {result.summary && (
                <div className="text-green-700">
                  <p>Trafic total : {(result.summary as Record<string, number>).total_traffic?.toLocaleString()}</p>
                  <p>Position moyenne : {(result.summary as Record<string, number>).avg_position}</p>
                  <p>Top 10 : {(result.summary as Record<string, number>).top_10} mots-cles</p>
                  <p>Top 3 : {(result.summary as Record<string, number>).top_3} mots-cles</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

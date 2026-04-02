"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Target, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AngleSuggestion {
  angle: string;
  rationale: string;
}

interface ArticleAngleCardProps {
  articleId: string;
  currentAngle: string | null;
  onSave: (angle: string) => void;
  hasAnalysis: boolean;
}

export function ArticleAngleCard({
  articleId,
  currentAngle,
  onSave,
  hasAnalysis,
}: ArticleAngleCardProps) {
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<AngleSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [angle, setAngle] = useState(currentAngle || "");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  async function generateSuggestions() {
    setLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/generate-angle`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Erreur generation");
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible de generer les angles",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!angle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/save-editorial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_angle: angle }),
      });
      if (!res.ok) throw new Error("Erreur sauvegarde");
      onSave(angle);
      toast({ title: "Angle sauvegarde" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible de sauvegarder",
      });
    } finally {
      setSaving(false);
    }
  }

  function selectSuggestion(idx: number) {
    setSelectedIdx(idx);
    setAngle(suggestions[idx].angle);
  }

  const CATEGORY_COLORS: Record<string, string> = {
    experience: "bg-blue-100 text-blue-800",
    donnees: "bg-green-100 text-green-800",
    "contre-pied": "bg-orange-100 text-orange-800",
    expert: "bg-purple-100 text-purple-800",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-indigo-500" />
            <CardTitle className="text-base">Angle unique de l&apos;article</CardTitle>
          </div>
          {currentAngle && (
            <Badge variant="outline" className="text-green-600 border-green-300">
              <Check className="h-3 w-3 mr-1" /> Defini
            </Badge>
          )}
        </div>
        <CardDescription>
          Quel angle differencie cet article des concurrents ? Ecrivez le votre ou generez des suggestions IA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manual input */}
        <textarea
          value={angle}
          onChange={(e) => {
            setAngle(e.target.value);
            setSelectedIdx(null);
          }}
          placeholder="Ex: Test terrain de 3 mois avec mesures reelles de consommation..."
          rows={3}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={generateSuggestions}
            disabled={loading || !hasAnalysis}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            {loading ? "Generation..." : "Propositions IA"}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !angle.trim()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Sauvegarder
          </Button>
        </div>

        {!hasAnalysis && (
          <p className="text-xs text-muted-foreground">Lancez l&apos;analyse SERP pour activer les suggestions IA.</p>
        )}

        {/* AI Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Suggestions IA :</p>
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectSuggestion(i)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedIdx === i
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <p className="text-sm font-medium">{s.angle}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.rationale}</p>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

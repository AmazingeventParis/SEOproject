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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Sparkles,
  ListChecks,
  Plus,
  X,
  Check,
  User,
  Bot,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WritingDirective {
  id: string;
  label: string;
  category?: string;
  checked: boolean;
  source: "ai" | "user";
}

interface WritingDirectivesCardProps {
  articleId: string;
  currentDirectives: WritingDirective[] | null;
  onSave: (directives: WritingDirective[]) => void;
  hasAnalysis: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  experience: { label: "Experience", color: "bg-blue-100 text-blue-700" },
  donnees: { label: "Donnees", color: "bg-green-100 text-green-700" },
  contre_pied: { label: "Contre-pied", color: "bg-orange-100 text-orange-700" },
  astuce: { label: "Astuce expert", color: "bg-purple-100 text-purple-700" },
  engagement: { label: "Engagement", color: "bg-pink-100 text-pink-700" },
  preuve_sociale: { label: "Preuve sociale", color: "bg-yellow-100 text-yellow-700" },
};

export function WritingDirectivesCard({
  articleId,
  currentDirectives,
  onSave,
  hasAnalysis,
}: WritingDirectivesCardProps) {
  const { toast } = useToast();
  const [directives, setDirectives] = useState<WritingDirective[]>(
    currentDirectives || []
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customText, setCustomText] = useState("");

  async function generateDirectives() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/articles/${articleId}/generate-directives`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Erreur generation");
      const data = await res.json();
      const newDirectives = (data.directives || []).map(
        (d: WritingDirective) => ({
          ...d,
          id: d.id || crypto.randomUUID(),
          checked: true,
          source: "ai" as const,
        })
      );
      // Merge with existing user directives
      const userDirectives = directives.filter((d) => d.source === "user");
      setDirectives([...newDirectives, ...userDirectives]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error
            ? err.message
            : "Impossible de generer les directives",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/save-editorial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing_directives: directives }),
      });
      if (!res.ok) throw new Error("Erreur sauvegarde");
      onSave(directives);
      toast({ title: "Directives sauvegardees" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Impossible de sauvegarder",
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleDirective(id: string) {
    setDirectives((prev) =>
      prev.map((d) => (d.id === id ? { ...d, checked: !d.checked } : d))
    );
  }

  function removeDirective(id: string) {
    setDirectives((prev) => prev.filter((d) => d.id !== id));
  }

  function addCustomDirective() {
    if (!customText.trim()) return;
    setDirectives((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: customText.trim(),
        checked: true,
        source: "user",
      },
    ]);
    setCustomText("");
  }

  const checkedCount = directives.filter((d) => d.checked).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-500" />
            <CardTitle className="text-base">
              Directives d&apos;ecriture
            </CardTitle>
          </div>
          {directives.length > 0 && (
            <Badge variant="outline">
              {checkedCount}/{directives.length} actives
            </Badge>
          )}
        </div>
        <CardDescription>
          Instructions concretes pour donner une touche humaine et authentique a
          l&apos;article.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Directive list */}
        {directives.length > 0 && (
          <div className="space-y-2">
            {directives.map((d) => (
              <div
                key={d.id}
                className={`flex items-start gap-3 p-2 rounded-lg border transition-all ${
                  d.checked
                    ? "bg-white border-gray-200"
                    : "bg-gray-50 border-gray-100 opacity-60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleDirective(d.id)}
                  className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                    d.checked
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {d.checked && <Check className="h-3 w-3" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm ${
                      d.checked ? "" : "line-through text-muted-foreground"
                    }`}
                  >
                    {d.label}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {d.category &&
                      CATEGORY_LABELS[d.category] && (
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 ${CATEGORY_LABELS[d.category].color}`}
                        >
                          {CATEGORY_LABELS[d.category].label}
                        </Badge>
                      )}
                    {d.source === "ai" ? (
                      <Bot className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <User className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeDirective(d.id)}
                  className="flex-shrink-0 p-1 rounded hover:bg-gray-100 text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add custom directive */}
        <div className="flex gap-2">
          <Input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Ajouter une directive personnalisee..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomDirective();
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={addCustomDirective}
            disabled={!customText.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={generateDirectives}
            disabled={loading}
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
            disabled={saving || directives.length === 0}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Sauvegarder
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

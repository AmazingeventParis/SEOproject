"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type {
  Article,
  ContentBlock,
  PipelineRun,
  TitleSuggestion,
  AuthorityLinkSuggestion,
  SelectedAuthorityLink,
} from "@/lib/supabase/types";
import { getStepLabel } from "@/lib/pipeline/state-machine";
import { StatusBadge } from "@/components/articles/status-badge";
import { PipelineProgress } from "@/components/articles/pipeline-progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RichTextEditor } from "@/components/rich-text-editor";
import { ModelSelector } from "@/components/articles/model-selector";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe,
  Image,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  PenLine,
  Eye,
  AlertCircle,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
  Check,
  Link2,
  AlertTriangle,
  CheckCircle2,
  MessageSquarePlus,
  X,
  Undo2,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface ArticleWithRelations extends Article {
  seo_sites: { name: string; domain: string } | null;
  seo_personas: { name: string; role: string } | null;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  h2: "H2",
  h3: "H3",
  h4: "H4",
  paragraph: "Paragraphe",
  list: "Liste",
  faq: "FAQ",
  callout: "Encadre",
  image: "Image",
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  h2: "bg-blue-100 text-blue-700",
  h3: "bg-sky-100 text-sky-700",
  h4: "bg-indigo-100 text-indigo-700",
  paragraph: "bg-gray-100 text-gray-700",
  list: "bg-amber-100 text-amber-700",
  faq: "bg-purple-100 text-purple-700",
  callout: "bg-teal-100 text-teal-700",
  image: "bg-pink-100 text-pink-700",
};

const BLOCK_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  written: "Ecrit",
  approved: "Approuve",
};

function SerpDataDisplay({ serpData }: { serpData: Record<string, unknown> }) {
  const organicResults = Array.isArray(serpData.organic_results)
    ? (serpData.organic_results as Array<{ title?: string; link?: string; position?: number }>)
    : [];
  const paaQuestions = Array.isArray(serpData.people_also_ask)
    ? (serpData.people_also_ask as Array<{ question?: string }>)
    : [];
  const cannibalization = serpData.cannibalization ?? null;

  return (
    <div className="space-y-4">
      {organicResults.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Top resultats</h4>
          <div className="space-y-2">
            {organicResults.slice(0, 5).map((result, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground font-mono text-xs w-5">
                  #{result.position ?? i + 1}
                </span>
                <a
                  href={result.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline truncate"
                >
                  {result.title ?? result.link}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {paaQuestions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Questions frequentes (PAA)</h4>
          <ul className="space-y-1">
            {paaQuestions.map((paa, i) => (
              <li
                key={i}
                className="text-sm text-muted-foreground flex items-start gap-2"
              >
                <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" />
                {paa.question ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cannibalization != null && (
        <div>
          <h4 className="text-sm font-medium mb-2">Cannibalisation</h4>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
            {JSON.stringify(cannibalization, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Group blocks into H2 sections: each section starts with an H2 and includes all following blocks until the next H2
interface H2Section {
  h2Block: ContentBlock;
  h2Index: number;
  children: { block: ContentBlock; index: number }[];
}

function groupBlocksByH2(blocks: ContentBlock[]): { sections: H2Section[]; orphans: { block: ContentBlock; index: number }[] } {
  const sections: H2Section[] = [];
  const orphans: { block: ContentBlock; index: number }[] = [];
  let current: H2Section | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "h2") {
      current = { h2Block: block, h2Index: i, children: [] };
      sections.push(current);
    } else if (block.type === "faq") {
      // FAQ is a standalone section, not nested under an H2
      sections.push({ h2Block: block, h2Index: i, children: [] });
      current = null;
    } else if (current) {
      current.children.push({ block, index: i });
    } else {
      orphans.push({ block, index: i });
    }
  }
  return { sections, orphans };
}

// ---- Title Selection Card ----
function TitleSelectionCard({
  suggestions,
  onSelect,
  onRegenerate,
  isLoading,
  isRegenerating,
}: {
  suggestions: TitleSuggestion[];
  onSelect: (index: number) => void;
  onRegenerate: () => void;
  isLoading: boolean;
  isRegenerating: boolean;
}) {
  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          Choisissez un titre H1
        </CardTitle>
        <CardDescription>
          3 variantes optimisees SEO — selectionnez celle qui convient le mieux
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((suggestion, index) => {
          const isSelected = suggestion.selected;
          const strategyLabels = ["Question", "Promesse", "Specifique"];

          return (
            <button
              key={index}
              onClick={() => onSelect(index)}
              disabled={isLoading}
              className={`w-full text-left rounded-lg border-2 p-3 transition-all ${
                isSelected
                  ? "border-blue-500 bg-blue-100/80 ring-1 ring-blue-500/30"
                  : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/30"
              } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        index === 0
                          ? "bg-purple-100 text-purple-700"
                          : index === 1
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {strategyLabels[index] || `Option ${index + 1}`}
                    </Badge>
                    {isSelected && (
                      <Badge className="bg-blue-600 text-white text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        Selectionne
                      </Badge>
                    )}
                  </div>
                  <p className="font-medium text-sm">{suggestion.title}</p>
                  {suggestion.seo_title && suggestion.seo_title !== suggestion.title && (
                    <p className="text-xs text-blue-600 mt-1">
                      Title SEO : {suggestion.seo_title}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    /{suggestion.slug}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    {suggestion.seo_rationale}
                  </p>
                </div>
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-1 ${
                    isSelected
                      ? "border-blue-500 bg-blue-500"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>
              </div>
            </button>
          );
        })}
        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Regenerer les suggestions de titre
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Authority Link Card ----
function AuthorityLinkCard({
  suggestions,
  selectedLink,
  onSelect,
  onCustomSelect,
  onRegenerate,
  isLoading,
  isRegenerating,
}: {
  suggestions: AuthorityLinkSuggestion[];
  selectedLink: SelectedAuthorityLink | null;
  onSelect: (index: number) => void;
  onCustomSelect: (url: string, title: string, anchorContext: string) => void;
  onRegenerate: () => void;
  isLoading: boolean;
  isRegenerating: boolean;
}) {
  const [customUrl, setCustomUrl] = React.useState("");
  const [customTitle, setCustomTitle] = React.useState("");

  return (
    <Card className="border-emerald-200 bg-emerald-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-emerald-600" />
          Lien d&apos;autorite (optionnel)
        </CardTitle>
        <CardDescription>
          Source externe fiable pour renforcer l&apos;E-E-A-T — sera integre dans un bloc H2
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((suggestion, index) => {
          const isSelected = suggestion.selected;

          return (
            <button
              key={index}
              onClick={() => onSelect(index)}
              disabled={isLoading}
              className={`w-full text-left rounded-lg border-2 p-3 transition-all ${
                isSelected
                  ? "border-emerald-500 bg-emerald-100/80 ring-1 ring-emerald-500/30"
                  : "border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"
              } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="secondary"
                      className="text-xs bg-emerald-100 text-emerald-700"
                    >
                      {suggestion.domain}
                    </Badge>
                    {suggestion.is_valid ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                    )}
                    {isSelected && (
                      <Badge className="bg-emerald-600 text-white text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        Selectionne
                      </Badge>
                    )}
                  </div>
                  <p className="font-medium text-sm">{suggestion.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {suggestion.snippet}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 italic">
                    {suggestion.rationale}
                  </p>
                  <p className="text-xs text-emerald-600 mt-1 truncate">
                    {suggestion.url}
                  </p>
                </div>
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-1 ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>
              </div>
            </button>
          );
        })}

        {/* Custom link input */}
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Ou saisir un lien personnalise :
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="https://..."
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="text-sm h-8"
            />
            <Input
              placeholder="Titre (optionnel)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="text-sm h-8 w-48"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              onClick={() => {
                if (customUrl) {
                  onCustomSelect(customUrl, customTitle, "");
                  setCustomUrl("");
                  setCustomTitle("");
                }
              }}
              disabled={!customUrl || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Selected link display when it's a custom one */}
        {selectedLink && !suggestions.some((s) => s.selected) && (
          <div className="rounded-lg border-2 border-emerald-500 bg-emerald-100/80 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-emerald-600 text-white text-xs">
                <Check className="h-3 w-3 mr-1" />
                Lien personnalise selectionne
              </Badge>
            </div>
            <p className="font-medium text-sm">{selectedLink.title}</p>
            <p className="text-xs text-emerald-600 truncate">{selectedLink.url}</p>
          </div>
        )}

        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Regenerer les suggestions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Content Gap types & helpers ----
interface ContentGapItem {
  label: string;
  type: string;
  description: string;
}

const GAP_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  calculator: { icon: "🧮", label: "Calculateur", color: "bg-blue-100 text-blue-700 border-blue-200" },
  comparison: { icon: "📊", label: "Comparatif", color: "bg-purple-100 text-purple-700 border-purple-200" },
  checklist: { icon: "✅", label: "Checklist", color: "bg-green-100 text-green-700 border-green-200" },
  specific_question: { icon: "❓", label: "Question", color: "bg-orange-100 text-orange-700 border-orange-200" },
  interactive: { icon: "🎯", label: "Interactif", color: "bg-pink-100 text-pink-700 border-pink-200" },
  data: { icon: "📈", label: "Donnees", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  text: { icon: "📝", label: "Contenu", color: "bg-gray-100 text-gray-600 border-gray-200" },
};

/** Normalize gap from Gemini (could be string or object) to ContentGapItem */
function normalizeGap(raw: unknown): ContentGapItem {
  if (typeof raw === "string") {
    return { label: raw, type: "text", description: "" };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      label: String(obj.label || obj.gap || ""),
      type: String(obj.type || "text"),
      description: String(obj.description || ""),
    };
  }
  return { label: String(raw), type: "text", description: "" };
}

/** Serialize a gap item to a descriptive string for storage & plan architect */
function serializeGap(item: ContentGapItem): string {
  const typeConf = GAP_TYPE_CONFIG[item.type] || GAP_TYPE_CONFIG.text;
  if (item.description) {
    return `[${typeConf.label}] ${item.label} — ${item.description}`;
  }
  return item.label;
}

// ---- Content Gap Selector ----
function ContentGapSelector({
  contentGaps,
  selectedContentGaps,
  onConfirm,
  isLoading,
}: {
  contentGaps: unknown[];
  selectedContentGaps: string[] | undefined;
  onConfirm: (gaps: string[]) => void;
  isLoading: boolean;
}) {
  const items = React.useMemo(() => contentGaps.map(normalizeGap), [contentGaps]);
  const isConfirmed = selectedContentGaps !== undefined;
  const [selected, setSelected] = React.useState<Set<number>>(
    () => {
      if (!selectedContentGaps) return new Set();
      // Match saved strings back to items by label
      const indices = new Set<number>();
      for (const saved of selectedContentGaps) {
        const idx = items.findIndex(
          (item) => saved === serializeGap(item) || saved === item.label || saved.includes(item.label)
        );
        if (idx >= 0) indices.add(idx);
      }
      return indices;
    }
  );

  const toggleGap = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const serialized = Array.from(selected).map((i) => serializeGap(items[i]));
    onConfirm(serialized);
  };

  if (isConfirmed) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-amber-600" />
            Lacunes de contenu
          </CardTitle>
          <CardDescription>
            {selectedContentGaps.length === 0
              ? "Aucune lacune selectionnee — le plan sera genere sans contrainte de lacunes."
              : `${selectedContentGaps.length} lacune(s) selectionnee(s) — seront integrees au plan.`}
          </CardDescription>
        </CardHeader>
        {selectedContentGaps.length > 0 && (
          <CardContent className="flex flex-wrap gap-2">
            {selectedContentGaps.map((gap, i) => (
              <Badge key={i} variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                {gap}
              </Badge>
            ))}
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-amber-600" />
          Opportunites de contenu detectees
        </CardTitle>
        <CardDescription>
          Selectionnez les elements a integrer dans le plan. Les formats non-texte (calculateurs, comparatifs...) vous differencient de la concurrence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, index) => {
          const typeConf = GAP_TYPE_CONFIG[item.type] || GAP_TYPE_CONFIG.text;
          const isSelected = selected.has(index);
          return (
            <button
              key={index}
              onClick={() => toggleGap(index)}
              disabled={isLoading}
              className={`w-full text-left rounded-lg border-2 p-3 transition-all ${
                isSelected
                  ? "border-amber-500 bg-amber-50/80 ring-1 ring-amber-500/30"
                  : "border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/30"
              } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 ${
                    isSelected
                      ? "border-amber-500 bg-amber-500"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${typeConf.color}`}>
                      {typeConf.icon} {typeConf.label}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        <div className="flex items-center justify-between pt-3">
          <span className="text-sm text-muted-foreground">
            {selected.size} selectionnee(s)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onConfirm([])}
              disabled={isLoading}
            >
              Passer (aucune)
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleConfirm}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-2 h-3.5 w-3.5" />
              )}
              Confirmer
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Links Summary Card ----
function LinksSummaryCard({
  blocks,
  siteDomain,
}: {
  blocks: ContentBlock[];
  siteDomain: string | null;
}) {
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  const allLinks: { url: string; anchor: string; blockHeading: string; isInternal: boolean }[] = [];

  for (const block of blocks) {
    if (!block.content_html || block.status === "pending") continue;
    let match;
    linkRegex.lastIndex = 0;
    while ((match = linkRegex.exec(block.content_html)) !== null) {
      const url = match[1];
      const anchor = match[2].replace(/<[^>]*>/g, "").trim();
      const isInternal =
        (siteDomain && url.includes(siteDomain)) || url.startsWith("/");
      allLinks.push({
        url,
        anchor,
        blockHeading: block.heading || `Bloc ${block.type}`,
        isInternal: !!isInternal,
      });
    }
  }

  const internalLinks = allLinks.filter((l) => l.isInternal);
  const externalLinks = allLinks.filter((l) => !l.isInternal);

  if (allLinks.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          Resume des liens
          <Badge variant="secondary" className="text-xs">
            {internalLinks.length} internes, {externalLinks.length} externes
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {internalLinks.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Liens internes</h4>
            <div className="space-y-1.5">
              {internalLinks.map((link, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="text-xs shrink-0 bg-blue-50 text-blue-600 border-blue-200">
                    Interne
                  </Badge>
                  <div className="min-w-0">
                    <span className="font-medium">{link.anchor}</span>
                    <span className="text-muted-foreground text-xs ml-2 truncate block">
                      {link.url}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      dans : {link.blockHeading}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {externalLinks.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Liens externes</h4>
            <div className="space-y-1.5">
              {externalLinks.map((link, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="text-xs shrink-0 bg-emerald-50 text-emerald-600 border-emerald-200">
                    Externe
                  </Badge>
                  <div className="min-w-0">
                    <span className="font-medium">{link.anchor}</span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline ml-2 truncate block"
                    >
                      {link.url}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      dans : {link.blockHeading}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ArticleDetailPage() {
  const params = useParams();
  const articleId = params.articleId as string;
  const router = useRouter();
  const { toast } = useToast();

  const [article, setArticle] = useState<ArticleWithRelations | null>(null);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [streamingBlockId, setStreamingBlockId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingHtml, setEditingHtml] = useState<string>("");
  const [savingBlock, setSavingBlock] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [writeProgress, setWriteProgress] = useState<{ current: number; total: number } | null>(null);

  const fetchArticle = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) throw new Error("Erreur");
      const data = await res.json();
      setArticle(data);
    } catch {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de charger l'article.",
      });
    } finally {
      setLoading(false);
    }
  }, [articleId, toast]);

  const fetchPipelineRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}/pipeline`);
      if (res.ok) {
        const data = await res.json();
        setPipelineRuns(data);
      }
    } catch {
      // silent
    }
  }, [articleId]);

  useEffect(() => {
    fetchArticle();
    fetchPipelineRuns();
  }, [fetchArticle, fetchPipelineRuns]);

  async function runPipelineAction(endpoint: string, label: string) {
    setActionLoading(label);
    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        ...(selectedModel
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: selectedModel }),
            }
          : {}),
      };
      const res = await fetch(
        `/api/articles/${articleId}/${endpoint}`,
        fetchOptions
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }
      toast({
        title: "Action lancee",
        description: `${label} en cours...`,
      });
      // Refetch article and pipeline
      await Promise.all([fetchArticle(), fetchPipelineRuns()]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function rollbackPipeline() {
    setActionLoading("rollback");
    try {
      const res = await fetch(`/api/articles/${articleId}/rollback`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }
      const result = await res.json();
      toast({
        title: "Retour en arriere",
        description: `Statut revenu a "${result.label}".`,
      });
      await Promise.all([fetchArticle(), fetchPipelineRuns()]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Impossible de revenir en arriere.",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function runWriteAll() {
    setActionLoading("Redaction");
    setWriteProgress(null);
    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        ...(selectedModel
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: selectedModel }),
            }
          : {}),
      };
      const res = await fetch(
        `/api/articles/${articleId}/write-all`,
        fetchOptions
      );
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erreur" }));
        throw new Error(err.error || "Erreur");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (eventType === "progress") {
                setWriteProgress({ current: parsed.current, total: parsed.total });
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      }

      toast({
        title: "Redaction terminee",
        description: "Tous les blocs ont ete rediges.",
      });
      await Promise.all([fetchArticle(), fetchPipelineRuns()]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Erreur lors de la redaction.",
      });
    } finally {
      setActionLoading(null);
      setWriteProgress(null);
    }
  }

  async function runAnalyzeThenPlan(skipAnalyze = false) {
    try {
      let currentArticle = article;

      if (!skipAnalyze) {
        // 1. Run analyze
        setActionLoading("Analyse");
        const fetchOptions: RequestInit = {
          method: "POST",
          ...(selectedModel
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: selectedModel }),
              }
            : {}),
        };
        const res = await fetch(
          `/api/articles/${articleId}/analyze`,
          fetchOptions
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Erreur" }));
          throw new Error(err.error || "Erreur");
        }

        // 2. Refetch article to get serp_data
        const artRes = await fetch(`/api/articles/${articleId}`);
        const updatedArticle = await artRes.json();
        setArticle(updatedArticle);
        currentArticle = updatedArticle;
      }

      // 3. Check if content gaps exist
      const sd = (currentArticle?.serp_data as Record<string, unknown>) || null;
      const sem = sd?.semanticAnalysis as { contentGaps?: unknown[] } | undefined;
      const selectedGaps = sd?.selectedContentGaps as string[] | undefined;
      const hasGaps = sem?.contentGaps && sem.contentGaps.length > 0;
      const gapsAlreadyConfirmed = selectedGaps !== undefined;

      if (hasGaps && !gapsAlreadyConfirmed) {
        // Content gaps found and not yet confirmed — stop here, ContentGapSelector will show
        toast({
          title: "Analyse terminee",
          description: "Selectionnez les lacunes de contenu puis le plan sera genere.",
        });
        await fetchPipelineRuns();
        setActionLoading(null);
        return;
      }

      // 4. No gaps → auto-trigger plan
      setActionLoading("Generation du plan");
      const planOptions: RequestInit = {
        method: "POST",
        ...(selectedModel
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: selectedModel }),
            }
          : {}),
      };
      const planRes = await fetch(
        `/api/articles/${articleId}/plan`,
        planOptions
      );
      if (!planRes.ok) {
        const err = await planRes.json().catch(() => ({ error: "Erreur" }));
        throw new Error(err.error || "Erreur plan");
      }

      toast({
        title: "Plan genere",
        description: "L'analyse et le plan sont termines.",
      });
      await Promise.all([fetchArticle(), fetchPipelineRuns()]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Une erreur est survenue.",
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function writeBlock(blockId: string) {
    const currentBlocks: ContentBlock[] = article?.content_blocks ?? [];
    const blockIndex = currentBlocks.findIndex((b) => b.id === blockId);

    // Try streaming first (only works with Anthropic models)
    const canStream = !selectedModel || selectedModel.includes("claude");

    if (canStream && blockIndex >= 0) {
      setStreamingBlockId(blockId);
      setStreamingContent("");
      setActionLoading(`block-${blockId}`);

      try {
        const res = await fetch(`/api/articles/${articleId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockIndex }),
        });

        if (!res.ok || !res.body) {
          throw new Error("stream-fallback");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Parse SSE events: "event: content_block_delta\ndata: {...}\n\n"
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  accumulated += parsed.delta.text;
                  setStreamingContent(accumulated);
                }
              } catch {
                // Not valid JSON - might be partial, skip
              }
            }
          }
        }

        // Stream finished — save the block via regular endpoint
        setStreamingBlockId(null);
        setStreamingContent("");
        // Use the regular write-block to persist (will re-generate but ensures DB consistency)
        await fetch(`/api/articles/${articleId}/write-block`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ block_id: blockId, ...(selectedModel ? { model: selectedModel } : {}) }),
        });
        await Promise.all([fetchArticle(), fetchPipelineRuns()]);
        setActionLoading(null);
        return;
      } catch (err) {
        // Streaming failed — fall back to regular write
        setStreamingBlockId(null);
        setStreamingContent("");
        if (err instanceof Error && err.message !== "stream-fallback") {
          // Genuine error — still try regular write below
        }
      }
    }

    // Regular (non-streaming) write
    setActionLoading(`block-${blockId}`);
    try {
      const res = await fetch(`/api/articles/${articleId}/write-block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block_id: blockId, ...(selectedModel ? { model: selectedModel } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }
      toast({
        title: "Bloc redige",
        description: "La redaction du bloc est terminee.",
      });
      await Promise.all([fetchArticle(), fetchPipelineRuns()]);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description:
          err instanceof Error ? err.message : "Erreur lors de la redaction.",
      });
    } finally {
      setActionLoading(null);
    }
  }

  // Write all blocks in an H2 section sequentially
  async function writeSection(sectionBlockIds: string[]) {
    const label = `section-${sectionBlockIds[0]}`;
    setActionLoading(label);
    try {
      for (const blockId of sectionBlockIds) {
        await writeBlock(blockId);
      }
      toast({ title: "Section redigee", description: `${sectionBlockIds.length} bloc(s) redige(s).` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de la redaction.",
      });
    } finally {
      setActionLoading(null);
    }
  }

  // Save manual edit of a block's content_html
  async function saveBlockEdit(blockId: string, newHtml: string) {
    setSavingBlock(blockId);
    try {
      const currentBlocks: ContentBlock[] = article?.content_blocks ?? [];
      const updatedBlocks = currentBlocks.map((b) =>
        b.id === blockId ? { ...b, content_html: newHtml } : b
      );
      const res = await fetch(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_blocks: updatedBlocks }),
      });
      if (!res.ok) throw new Error("Erreur de sauvegarde");
      setEditingBlockId(null);
      setEditingHtml("");
      toast({ title: "Bloc mis a jour", description: "Le contenu a ete sauvegarde." });
      await fetchArticle();
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de sauvegarder." });
    } finally {
      setSavingBlock(null);
    }
  }

  // Delete article
  async function handleDelete() {
    if (!confirm("Supprimer cet article et toutes ses donnees pipeline ? Cette action est irreversible.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Erreur");
      toast({ title: "Article supprime" });
      router.push("/dashboard/articles");
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de supprimer l'article." });
      setDeleting(false);
    }
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  // Add or remove FAQ block from the plan
  async function toggleFaqBlock() {
    if (!article) return;
    const currentBlocks: ContentBlock[] = article.content_blocks ?? [];
    const hasFaq = currentBlocks.some((b) => b.type === "faq");

    let updatedBlocks: ContentBlock[];
    if (hasFaq) {
      // Remove FAQ block
      updatedBlocks = currentBlocks.filter((b) => b.type !== "faq");
    } else {
      // Add FAQ block at the end
      const faqBlock: ContentBlock = {
        id: crypto.randomUUID(),
        type: "faq",
        heading: "FAQ",
        content_html: "",
        nugget_ids: [],
        word_count: 0,
        status: "pending",
        writing_directive: "Ecris 3 a 6 questions-reponses basees sur les People Also Ask. Format accordion HTML avec Schema.org.",
        format_hint: "prose",
      };
      updatedBlocks = [...currentBlocks, faqBlock];
    }

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_blocks: updatedBlocks }),
      });
      if (!res.ok) throw new Error("Erreur");
      toast({
        title: hasFaq ? "FAQ supprimee" : "FAQ ajoutee",
        description: hasFaq ? "Le bloc FAQ a ete retire du plan." : "Un bloc FAQ a ete ajoute en fin de plan.",
      });
      await fetchArticle();
    } catch {
      toast({ variant: "destructive", title: "Erreur", description: "Impossible de modifier la FAQ." });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/articles"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Retour aux articles
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">Article introuvable.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const blocks: ContentBlock[] = article.content_blocks ?? [];
  const writtenBlocks = blocks.filter((b) => b.status !== "pending");
  const pendingBlocks = blocks.filter((b) => b.status === "pending");
  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/articles"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Retour aux articles
      </Link>

      {/* Top section: Title + Status + Actions */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {article.keyword}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={article.status} />
              {article.seo_sites && (
                <Badge variant="secondary">{article.seo_sites.name}</Badge>
              )}
              {article.seo_personas && (
                <span className="text-sm text-muted-foreground">
                  par {article.seo_personas.name}
                </span>
              )}
              {article.word_count > 0 && (
                <span className="text-sm text-muted-foreground">
                  {article.word_count.toLocaleString("fr-FR")} mots
                </span>
              )}
            </div>
          </div>

          {/* Model selector + Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {(article.status === "draft" ||
              article.status === "analyzing" ||
              article.status === "planning" ||
              article.status === "writing") && (
              <ModelSelector
                value={selectedModel}
                onChange={setSelectedModel}
                step={article.status === "planning" || article.status === "writing" ? "write" : "plan"}
              />
            )}
            {article.status === "draft" && (
              <Button
                onClick={() => runAnalyzeThenPlan()}
                disabled={!!actionLoading}
              >
                {actionLoading === "Analyse" || actionLoading === "Generation du plan" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                {actionLoading === "Generation du plan" ? "Generation du plan..." : "Analyser et planifier"}
              </Button>
            )}
            {article.status === "analyzing" && (
              <Button
                onClick={() => runAnalyzeThenPlan(true)}
                disabled={!!actionLoading}
              >
                {actionLoading === "Generation du plan" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {actionLoading === "Generation du plan" ? "Generation du plan..." : "Generer le plan"}
              </Button>
            )}
            {article.status === "planning" && (
              <>
                {!article.persona_id && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Assignez un persona avant de rediger
                  </div>
                )}
                {!article.title && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Selectionnez un titre H1 avant de rediger
                  </div>
                )}
                <Button
                  onClick={() => runWriteAll()}
                  disabled={!!actionLoading || !article.persona_id || !article.title}
                >
                  {actionLoading === "Redaction" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PenLine className="mr-2 h-4 w-4" />
                  )}
                  Rediger
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    runPipelineAction("plan", "Regeneration du plan")
                  }
                  disabled={!!actionLoading}
                >
                  {actionLoading === "Regeneration du plan" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Regenerer le plan
                </Button>
              </>
            )}
            {article.status === "writing" && pendingBlocks.length > 0 && (
              <Button
                onClick={() => runWriteAll()}
                disabled={!!actionLoading || !article.persona_id}
              >
                {actionLoading === "Redaction" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PenLine className="mr-2 h-4 w-4" />
                )}
                Continuer la redaction
              </Button>
            )}
            {article.status === "writing" && pendingBlocks.length === 0 && (
              <Button
                onClick={() =>
                  runPipelineAction("media", "Generation media")
                }
                disabled={!!actionLoading}
              >
                {actionLoading === "Generation media" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Image className="mr-2 h-4 w-4" />
                )}
                Generer les medias
              </Button>
            )}
            {(article.status === "media" || article.status === "seo_check") && (
              <Button
                onClick={() =>
                  runPipelineAction("seo", "Verification SEO")
                }
                disabled={!!actionLoading}
              >
                {actionLoading === "Verification SEO" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="mr-2 h-4 w-4" />
                )}
                Verification SEO
              </Button>
            )}
            {article.status === "reviewing" && (
              <Button
                onClick={() =>
                  runPipelineAction("publish", "Publication")
                }
                disabled={!!actionLoading}
              >
                {actionLoading === "Publication" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="mr-2 h-4 w-4" />
                )}
                Publier sur WordPress
              </Button>
            )}
            {article.status === "published" && article.wp_url && (
              <a
                href={article.wp_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Voir sur WordPress
                </Button>
              </a>
            )}
            {/* Rollback button — visible when not draft/published */}
            {article.status !== "draft" && article.status !== "published" && (
              <Button
                variant="outline"
                onClick={rollbackPipeline}
                disabled={!!actionLoading}
                title="Revenir a l'etape precedente"
                className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:border-amber-300"
              >
                {actionLoading === "rollback" ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-4 w-4" />
                )}
                Retour
              </Button>
            )}
            {/* Refresh button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                fetchArticle();
                fetchPipelineRuns();
              }}
              title="Rafraichir"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {/* Delete button */}
            <Button
              variant="outline"
              size="icon"
              onClick={handleDelete}
              disabled={deleting}
              title="Supprimer l'article"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Pipeline progress */}
        <PipelineProgress status={article.status} showLabels />

        {/* Write-all progress bar */}
        {writeProgress && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Redaction en cours...</span>
              <span>{writeProgress.current}/{writeProgress.total} blocs</span>
            </div>
            <Progress value={(writeProgress.current / writeProgress.total) * 100} />
          </div>
        )}
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="plan" className="w-full">
        <TabsList>
          <TabsTrigger value="plan">
            <FileText className="mr-1.5 h-4 w-4" />
            Plan
          </TabsTrigger>
          <TabsTrigger value="content">
            <Eye className="mr-1.5 h-4 w-4" />
            Contenu
          </TabsTrigger>
          <TabsTrigger value="seo">
            <Search className="mr-1.5 h-4 w-4" />
            SEO
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <Play className="mr-1.5 h-4 w-4" />
            Pipeline
          </TabsTrigger>
        </TabsList>

        {/* ========== PLAN TAB ========== */}
        <TabsContent value="plan" className="space-y-4">
          {blocks.length === 0 ? (
            <div className="space-y-4">
              {/* Content Gap Selector — shown when analyzing and gaps exist */}
              {article.status === "analyzing" &&
                (() => {
                  const sd = article.serp_data as Record<string, unknown> | null;
                  const sem = sd?.semanticAnalysis as { contentGaps?: unknown[] } | undefined;
                  const gaps = sem?.contentGaps;
                  const selectedGaps = sd?.selectedContentGaps as string[] | undefined;
                  if (gaps && gaps.length > 0) {
                    return (
                      <ContentGapSelector
                        contentGaps={gaps}
                        selectedContentGaps={selectedGaps}
                        onConfirm={async (selected) => {
                          try {
                            setActionLoading("select-content-gaps");
                            const res = await fetch(
                              `/api/articles/${articleId}/select-content-gaps`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ selected_gaps: selected }),
                              }
                            );
                            if (!res.ok) throw new Error("Erreur");
                            const data = await res.json();
                            setArticle(data);
                            toast({
                              title: "Lacunes confirmees",
                              description:
                                selected.length === 0
                                  ? "Aucune lacune selectionnee."
                                  : `${selected.length} lacune(s) selectionnee(s).`,
                            });

                            // Auto-trigger plan after gap confirmation
                            setActionLoading("Generation du plan");
                            const planOptions: RequestInit = {
                              method: "POST",
                              ...(selectedModel
                                ? {
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ model: selectedModel }),
                                  }
                                : {}),
                            };
                            const planRes = await fetch(
                              `/api/articles/${articleId}/plan`,
                              planOptions
                            );
                            if (!planRes.ok) {
                              const err = await planRes.json().catch(() => ({ error: "Erreur" }));
                              throw new Error(err.error || "Erreur plan");
                            }
                            toast({
                              title: "Plan genere",
                              description: "Le plan a ete genere avec les lacunes selectionnees.",
                            });
                            await Promise.all([fetchArticle(), fetchPipelineRuns()]);
                          } catch (err) {
                            toast({
                              variant: "destructive",
                              title: "Erreur",
                              description: err instanceof Error ? err.message : "Impossible de sauvegarder la selection.",
                            });
                          } finally {
                            setActionLoading(null);
                          }
                        }}
                        isLoading={actionLoading === "select-content-gaps"}
                      />
                    );
                  }
                  return null;
                })()}

              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="mb-4 h-10 w-10 text-muted-foreground/50" />
                  <p className="text-muted-foreground text-center">
                    Aucun plan genere pour le moment.
                    <br />
                    {article.status === "draft" &&
                      "Lancez l'analyse puis la generation du plan."}
                    {article.status === "analyzing" &&
                      "Generez le plan une fois l'analyse terminee."}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (() => {
            const { sections, orphans } = groupBlocksByH2(blocks);
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {sections.length} sections - {writtenBlocks.length}/{blocks.length} blocs ecrits
                  </p>
                </div>

                {/* Title Selection */}
                {article.title_suggestions &&
                  (article.title_suggestions as TitleSuggestion[]).length > 0 && (
                    <TitleSelectionCard
                      suggestions={article.title_suggestions as TitleSuggestion[]}
                      onSelect={async (index) => {
                        try {
                          setActionLoading("select-title");
                          const res = await fetch(
                            `/api/articles/${articleId}/select-title`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title_index: index }),
                            }
                          );
                          if (!res.ok) throw new Error("Erreur");
                          const data = await res.json();
                          setArticle(data);
                          toast({
                            title: "Titre selectionne",
                            description: data.title,
                          });
                        } catch {
                          toast({
                            variant: "destructive",
                            title: "Erreur",
                            description: "Impossible de selectionner le titre.",
                          });
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      onRegenerate={async () => {
                        try {
                          setActionLoading("regenerate-titles");
                          const res = await fetch(
                            `/api/articles/${articleId}/suggest-titles`,
                            { method: "POST" }
                          );
                          if (!res.ok) throw new Error("Erreur");
                          const data = await res.json();
                          setArticle(data);
                          toast({
                            title: "Suggestions regenerees",
                            description: "Choisissez parmi les nouvelles suggestions.",
                          });
                        } catch {
                          toast({
                            variant: "destructive",
                            title: "Erreur",
                            description:
                              "Impossible de regenerer les suggestions.",
                          });
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      isLoading={actionLoading === "select-title"}
                      isRegenerating={actionLoading === "regenerate-titles"}
                    />
                  )}

                {/* Authority Link Selection */}
                {article.authority_link_suggestions &&
                  (article.authority_link_suggestions as AuthorityLinkSuggestion[]).length > 0 && (
                    <AuthorityLinkCard
                      suggestions={article.authority_link_suggestions as AuthorityLinkSuggestion[]}
                      selectedLink={article.selected_authority_link as SelectedAuthorityLink | null}
                      onSelect={async (index) => {
                        try {
                          setActionLoading("select-authority-link");
                          const res = await fetch(
                            `/api/articles/${articleId}/select-authority-link`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ link_index: index }),
                            }
                          );
                          if (!res.ok) throw new Error("Erreur");
                          const data = await res.json();
                          setArticle(data);
                          toast({
                            title: "Lien d'autorite selectionne",
                            description: "Le lien sera integre lors de la redaction.",
                          });
                        } catch {
                          toast({
                            variant: "destructive",
                            title: "Erreur",
                            description: "Impossible de selectionner le lien.",
                          });
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      onCustomSelect={async (url, title, anchorContext) => {
                        try {
                          setActionLoading("select-authority-link");
                          const res = await fetch(
                            `/api/articles/${articleId}/select-authority-link`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                custom_url: url,
                                custom_title: title || undefined,
                                anchor_context: anchorContext || undefined,
                              }),
                            }
                          );
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error || "Erreur");
                          }
                          const data = await res.json();
                          setArticle(data);
                          toast({
                            title: "Lien personnalise selectionne",
                            description: "Le lien sera integre lors de la redaction.",
                          });
                        } catch (err) {
                          toast({
                            variant: "destructive",
                            title: "Erreur",
                            description:
                              err instanceof Error
                                ? err.message
                                : "Impossible de verifier le lien.",
                          });
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      onRegenerate={async () => {
                        try {
                          setActionLoading("regenerate-authority-links");
                          const res = await fetch(
                            `/api/articles/${articleId}/suggest-authority-links`,
                            { method: "POST" }
                          );
                          if (!res.ok) throw new Error("Erreur");
                          const data = await res.json();
                          setArticle(data);
                          toast({
                            title: "Suggestions regenerees",
                            description: "Choisissez parmi les nouvelles suggestions.",
                          });
                        } catch {
                          toast({
                            variant: "destructive",
                            title: "Erreur",
                            description:
                              "Impossible de regenerer les suggestions.",
                          });
                        } finally {
                          setActionLoading(null);
                        }
                      }}
                      isLoading={actionLoading === "select-authority-link"}
                      isRegenerating={actionLoading === "regenerate-authority-links"}
                    />
                  )}

                {/* Orphan blocks (before first H2) */}
                {orphans.map(({ block, index }) => (
                  <Card key={block.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={BLOCK_TYPE_COLORS[block.type] ?? ""}>
                          {BLOCK_TYPE_LABELS[block.type] ?? block.type}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={
                            block.status === "written"
                              ? "bg-green-100 text-green-700 border-green-200"
                              : block.status === "approved"
                              ? "bg-blue-100 text-blue-700 border-blue-200"
                              : ""
                          }
                        >
                          {BLOCK_STATUS_LABELS[block.status] ?? block.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">#{index + 1}</span>
                        {block.word_count > 0 && (
                          <span className="text-xs text-muted-foreground">{block.word_count} mots</span>
                        )}

                        {/* Write button for pending orphan blocks */}
                        {block.status === "pending" && (
                          <div className="ml-auto">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => writeBlock(block.id)}
                              disabled={actionLoading === `block-${block.id}`}
                            >
                              {actionLoading === `block-${block.id}` ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="mr-1 h-3 w-3" />
                              )}
                              Ecrire
                            </Button>
                          </div>
                        )}

                        {/* Edit / Save buttons for written orphan blocks */}
                        {block.status !== "pending" && block.content_html && (
                          <div className="ml-auto flex items-center gap-1">
                            {editingBlockId === block.id ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => { setEditingBlockId(null); setEditingHtml(""); }}
                                >
                                  Annuler
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => saveBlockEdit(block.id, editingHtml)}
                                  disabled={savingBlock === block.id}
                                >
                                  {savingBlock === block.id ? (
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  ) : (
                                    <Save className="mr-1 h-3 w-3" />
                                  )}
                                  Sauvegarder
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => { setEditingBlockId(block.id); setEditingHtml(block.content_html); }}
                              >
                                <PenLine className="mr-1 h-3 w-3" />
                                Modifier
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {block.heading && <p className="font-medium mt-2">{block.heading}</p>}
                      {block.writing_directive && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 mt-1">
                          <span className="font-medium">Directive :</span> {block.writing_directive}
                        </p>
                      )}
                      {block.status !== "pending" && block.content_html && streamingBlockId !== block.id && (
                        editingBlockId === block.id ? (
                          <RichTextEditor
                            content={editingHtml}
                            onChange={setEditingHtml}
                          />
                        ) : (
                          <div
                            className="text-sm prose prose-sm max-w-none dark:prose-invert mt-2"
                            dangerouslySetInnerHTML={{ __html: block.content_html }}
                          />
                        )
                      )}
                      {streamingBlockId === block.id && streamingContent && (
                        <div className="text-sm prose prose-sm max-w-none border-l-2 border-blue-400 pl-3 animate-pulse mt-2">
                          <div dangerouslySetInnerHTML={{ __html: streamingContent.substring(0, 500) }} />
                          <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {/* H2 Sections */}
                {sections.map((section) => {
                  const allBlocksInSection = [
                    { block: section.h2Block, index: section.h2Index },
                    ...section.children,
                  ];
                  const sectionBlockIds = allBlocksInSection.map((b) => b.block.id);
                  const sectionPending = allBlocksInSection.filter((b) => b.block.status === "pending");
                  const sectionWritten = allBlocksInSection.filter((b) => b.block.status !== "pending");
                  const isExpanded = expandedSections.has(section.h2Block.id);
                  const isSectionLoading = actionLoading === `section-${sectionBlockIds[0]}`;
                  const sectionHeading = section.h2Block.heading || (section.h2Block.type === "faq" ? "FAQ" : `Section #${section.h2Index + 1}`);
                  const allWritten = sectionPending.length === 0;
                  const subSections = section.children.filter((c) => c.block.type === "h3" || c.block.type === "h4");

                  return (
                    <Card key={section.h2Block.id} className="overflow-hidden">
                      {/* Section header - always visible */}
                      <div
                        className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleSection(section.h2Block.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <Badge variant="outline" className={BLOCK_TYPE_COLORS[section.h2Block.type] ?? ""}>
                            {BLOCK_TYPE_LABELS[section.h2Block.type] ?? section.h2Block.type}
                          </Badge>
                          <span className="font-semibold truncate">{sectionHeading}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {sectionWritten.length}/{allBlocksInSection.length} blocs
                          </span>
                          {subSections.length > 0 && (
                            <Badge variant="outline" className="bg-sky-50 text-sky-600 border-sky-200 text-xs shrink-0">
                              {subSections.length} sous-section{subSections.length > 1 ? "s" : ""}
                            </Badge>
                          )}
                          {allWritten && (
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200 shrink-0">
                              Ecrit
                            </Badge>
                          )}
                          {section.h2Block.format_hint && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              {section.h2Block.format_hint}
                            </Badge>
                          )}
                        </div>

                        {/* Write section button */}
                        {sectionPending.length > 0 &&
                          (article.status === "writing" || article.status === "planning") && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                writeSection(sectionBlockIds.filter((id) => {
                                  const b = blocks.find((bl) => bl.id === id);
                                  return b?.status === "pending";
                                }));
                              }}
                              disabled={!!actionLoading || !article.persona_id}
                            >
                              {isSectionLoading ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <PenLine className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Ecrire cette section ({sectionPending.length})
                            </Button>
                          )}
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t">
                          {/* Writing directive */}
                          {section.h2Block.writing_directive && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 border-b">
                              <span className="font-medium">Directive :</span> {section.h2Block.writing_directive}
                            </div>
                          )}

                          {/* Each block in the section */}
                          {allBlocksInSection.map(({ block, index }) => {
                            const isSubHeading = block.type === "h3" || block.type === "h4";
                            const indentClass = block.type === "h3" ? "ml-4 border-l-2 border-sky-200" : block.type === "h4" ? "ml-8 border-l-2 border-indigo-200" : "";
                            return (
                            <div key={block.id} className={`border-b last:border-b-0 px-4 py-3 ${indentClass}`}>
                              {/* Sub-heading separator */}
                              {isSubHeading && (
                                <div className={`-mx-4 -mt-3 mb-3 px-4 py-1.5 ${block.type === "h3" ? "bg-sky-50/50" : "bg-indigo-50/50"}`}>
                                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {block.type === "h3" ? "Sous-section" : "Sous-sous-section"}
                                  </span>
                                </div>
                              )}
                              {/* Block header */}
                              <div className="flex items-center gap-2 flex-wrap mb-2">
                                <Badge variant="outline" className={`text-xs ${BLOCK_TYPE_COLORS[block.type] ?? ""}`}>
                                  {BLOCK_TYPE_LABELS[block.type] ?? block.type}
                                </Badge>
                                <Badge
                                  variant="secondary"
                                  className={`text-xs ${
                                    block.status === "written"
                                      ? "bg-green-100 text-green-700 border-green-200"
                                      : block.status === "approved"
                                      ? "bg-blue-100 text-blue-700 border-blue-200"
                                      : ""
                                  }`}
                                >
                                  {BLOCK_STATUS_LABELS[block.status] ?? block.status}
                                </Badge>
                                {block.word_count > 0 && (
                                  <span className="text-xs text-muted-foreground">{block.word_count} mots</span>
                                )}
                                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                                {block.format_hint && block.type !== "h2" && (
                                  <Badge variant="outline" className="text-xs">{block.format_hint}</Badge>
                                )}

                                {/* Edit / Save buttons for written blocks */}
                                {block.status !== "pending" && block.content_html && (
                                  <div className="ml-auto flex items-center gap-1">
                                    {editingBlockId === block.id ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-xs"
                                          onClick={() => { setEditingBlockId(null); setEditingHtml(""); }}
                                        >
                                          Annuler
                                        </Button>
                                        <Button
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={() => saveBlockEdit(block.id, editingHtml)}
                                          disabled={savingBlock === block.id}
                                        >
                                          {savingBlock === block.id ? (
                                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                          ) : (
                                            <Save className="mr-1 h-3 w-3" />
                                          )}
                                          Sauvegarder
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => { setEditingBlockId(block.id); setEditingHtml(block.content_html); }}
                                      >
                                        <PenLine className="mr-1 h-3 w-3" />
                                        Modifier
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Block heading */}
                              {block.heading && (
                                <p className={`font-medium mb-2 ${block.type === "h2" ? "text-lg" : block.type === "h3" ? "text-base" : block.type === "h4" ? "text-sm" : "text-base"}`}>
                                  {block.heading}
                                </p>
                              )}

                              {/* Writing directive for child blocks */}
                              {block.writing_directive && block.type !== "h2" && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                                  <span className="font-medium">Directive :</span> {block.writing_directive}
                                </p>
                              )}

                              {/* Streaming preview */}
                              {streamingBlockId === block.id && streamingContent && (
                                <div className="text-sm prose prose-sm max-w-none border-l-2 border-blue-400 pl-3 animate-pulse">
                                  <div dangerouslySetInnerHTML={{ __html: streamingContent.substring(0, 500) }} />
                                  <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-0.5" />
                                </div>
                              )}

                              {/* Content display or editor */}
                              {block.status !== "pending" && block.content_html && streamingBlockId !== block.id && (
                                editingBlockId === block.id ? (
                                  <RichTextEditor
                                    content={editingHtml}
                                    onChange={setEditingHtml}
                                  />
                                ) : (
                                  <div
                                    className="text-sm prose prose-sm max-w-none dark:prose-invert"
                                    dangerouslySetInnerHTML={{ __html: block.content_html }}
                                  />
                                )
                              )}

                              {/* Pending placeholder */}
                              {block.status === "pending" && !streamingContent && (
                                <p className="text-xs text-muted-foreground italic">En attente de redaction...</p>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}

                {/* FAQ toggle button */}
                {(article.status === "planning" || article.status === "writing") && (
                  <div className="flex justify-center pt-2">
                    {blocks.some((b) => b.type === "faq") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                        onClick={toggleFaqBlock}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Retirer la FAQ
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-purple-600 border-purple-200 hover:bg-purple-50 hover:border-purple-300"
                        onClick={toggleFaqBlock}
                      >
                        <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
                        Ajouter une FAQ
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </TabsContent>

        {/* ========== CONTENT TAB ========== */}
        <TabsContent value="content" className="space-y-4">
          {writtenBlocks.length === 0 && !article.content_html ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Eye className="mb-4 h-10 w-10 text-muted-foreground/50" />
                <p className="text-muted-foreground text-center">
                  Aucun contenu redige pour le moment.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <article className="prose prose-sm max-w-none dark:prose-invert">
                  {/* Title */}
                  {article.title && (
                    <h1 className="text-2xl font-bold mb-2">
                      {article.title}
                    </h1>
                  )}

                  {/* SEO Title */}
                  {article.seo_title && (
                    <div className="not-prose mb-3 rounded-md bg-blue-50 border border-blue-200 p-3">
                      <p className="text-xs font-medium text-blue-600 mb-1">
                        Title SEO (balise &lt;title&gt;)
                      </p>
                      <p className="text-sm font-medium">{article.seo_title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {article.seo_title.length} / 60 caracteres
                        {article.seo_title.length > 60 && (
                          <span className="text-destructive ml-1">(trop long)</span>
                        )}
                      </p>
                    </div>
                  )}

                  {/* Meta description */}
                  {article.meta_description && (
                    <div className="not-prose mb-6 rounded-md bg-muted p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Meta description
                      </p>
                      <p className="text-sm">{article.meta_description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {article.meta_description.length} caracteres
                      </p>
                    </div>
                  )}

                  {/* Content from blocks */}
                  {blocks
                    .filter((b) => b.status !== "pending")
                    .map((block) => (
                      <div key={block.id} className="mb-4">
                        {/* FAQ blocks include their own H2 in content_html */}
                        {block.heading && block.type !== "faq" && (
                          <>
                            {block.type === "h2" ? (
                              <h2>{block.heading}</h2>
                            ) : block.type === "h3" ? (
                              <h3>{block.heading}</h3>
                            ) : block.type === "h4" ? (
                              <h4>{block.heading}</h4>
                            ) : null}
                          </>
                        )}
                        {block.content_html && (
                          <div
                            dangerouslySetInnerHTML={{
                              __html: block.content_html,
                            }}
                          />
                        )}
                      </div>
                    ))}

                  {/* Fallback: full content_html if no blocks written yet */}
                  {writtenBlocks.length === 0 && article.content_html && (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: article.content_html,
                      }}
                    />
                  )}
                </article>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ========== SEO TAB ========== */}
        <TabsContent value="seo" className="space-y-4">
          {/* SERP data */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Donnees SERP</CardTitle>
              <CardDescription>
                Analyse des resultats de recherche pour &quot;{article.keyword}&quot;
              </CardDescription>
            </CardHeader>
            <CardContent>
              {article.serp_data &&
              Object.keys(article.serp_data).length > 0 ? (
                <SerpDataDisplay serpData={article.serp_data as Record<string, unknown>} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune donnee SERP disponible. Lancez l&apos;analyse pour
                  recuperer les donnees.
                </p>
              )}
            </CardContent>
          </Card>

          {/* SEO Title + Meta description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Meta SEO</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* SEO Title */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Title SEO (balise &lt;title&gt;)</p>
                {article.seo_title ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{article.seo_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {article.seo_title.length} / 60 caracteres
                      {article.seo_title.length > 60 && (
                        <span className="text-destructive ml-1">(trop long)</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Pas encore defini.</p>
                )}
              </div>

              {/* Meta description */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Meta description</p>
              {article.meta_description ? (
                <div className="space-y-1">
                  <p className="text-sm">{article.meta_description}</p>
                  <p className="text-xs text-muted-foreground">
                    {article.meta_description.length} / 160 caracteres
                    {article.meta_description.length > 160 && (
                      <span className="text-destructive ml-1">
                        (trop long)
                      </span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pas encore generee.
                </p>
              )}
              </div>
            </CardContent>
          </Card>

          {/* Links Summary */}
          {blocks.some((b) => b.status !== "pending" && b.content_html) && (
            <LinksSummaryCard
              blocks={blocks}
              siteDomain={article.seo_sites?.domain || null}
            />
          )}

          {/* JSON-LD */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">JSON-LD</CardTitle>
              <CardDescription>
                Donnees structurees pour les moteurs de recherche
              </CardDescription>
            </CardHeader>
            <CardContent>
              {article.json_ld &&
              Object.keys(article.json_ld).length > 0 ? (
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[400px]">
                  {JSON.stringify(article.json_ld, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pas encore genere.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PIPELINE TAB ========== */}
        <TabsContent value="pipeline" className="space-y-4">
          {pipelineRuns.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Play className="mb-4 h-10 w-10 text-muted-foreground/50" />
                <p className="text-muted-foreground text-center">
                  Aucune execution pipeline enregistree.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Etape</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Modele</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cout</TableHead>
                    <TableHead className="text-right">Duree</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipelineRuns.map((run) => (
                    <React.Fragment key={run.id}>
                      <TableRow>
                        <TableCell className="font-medium">
                          {getStepLabel(run.step as Parameters<typeof getStepLabel>[0])}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              run.status === "success"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : run.status === "running"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : run.status === "error"
                                ? "bg-red-100 text-red-700 border-red-200"
                                : "bg-gray-100 text-gray-700 border-gray-200"
                            }
                          >
                            {run.status === "success"
                              ? "Succes"
                              : run.status === "running"
                              ? "En cours"
                              : run.status === "error"
                              ? "Erreur"
                              : "Ignore"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {run.model_used ?? "-"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {run.tokens_in + run.tokens_out > 0
                            ? `${run.tokens_in.toLocaleString()} / ${run.tokens_out.toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {run.cost_usd > 0
                            ? `$${run.cost_usd.toFixed(4)}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {run.duration_ms > 0
                            ? run.duration_ms >= 1000
                              ? `${(run.duration_ms / 1000).toFixed(1)}s`
                              : `${run.duration_ms}ms`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(
                            new Date(run.created_at),
                            "dd/MM/yy HH:mm",
                            { locale: fr }
                          )}
                        </TableCell>
                      </TableRow>
                      {run.status === "error" && run.error && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="bg-red-50 dark:bg-red-950/20"
                          >
                            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                              <span>{run.error}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Cost summary */}
          {pipelineRuns.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Cout total pipeline
                  </span>
                  <span className="font-medium">
                    $
                    {pipelineRuns
                      .reduce((sum, r) => sum + r.cost_usd, 0)
                      .toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">
                    Tokens totaux (in / out)
                  </span>
                  <span className="font-medium">
                    {pipelineRuns
                      .reduce((sum, r) => sum + r.tokens_in, 0)
                      .toLocaleString()}{" "}
                    /{" "}
                    {pipelineRuns
                      .reduce((sum, r) => sum + r.tokens_out, 0)
                      .toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

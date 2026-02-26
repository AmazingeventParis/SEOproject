"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type {
  Article,
  ContentBlock,
  PipelineRun,
  TitleSuggestion,
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
import { Textarea } from "@/components/ui/textarea";
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
  paragraph: "Paragraphe",
  list: "Liste",
  faq: "FAQ",
  callout: "Encadre",
  image: "Image",
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  h2: "bg-blue-100 text-blue-700",
  h3: "bg-sky-100 text-sky-700",
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
                onClick={() => runPipelineAction("analyze", "Analyse")}
                disabled={!!actionLoading}
              >
                {actionLoading === "Analyse" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Analyser
              </Button>
            )}
            {article.status === "analyzing" && (
              <Button
                onClick={() =>
                  runPipelineAction("plan", "Generation du plan")
                }
                disabled={!!actionLoading}
              >
                {actionLoading === "Generation du plan" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Generer le plan
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
                  onClick={() =>
                    runPipelineAction("write-all", "Redaction")
                  }
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
                onClick={() =>
                  runPipelineAction("write-all", "Redaction")
                }
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
                      </div>
                      {block.heading && <p className="font-medium mt-2">{block.heading}</p>}
                      {block.status !== "pending" && block.content_html && (
                        <div
                          className="text-sm text-muted-foreground prose prose-sm max-w-none mt-2"
                          dangerouslySetInnerHTML={{ __html: block.content_html }}
                        />
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

                  return (
                    <Card key={section.h2Block.id} className="overflow-hidden">
                      {/* Section header - always visible */}
                      <div
                        className="flex items-center justify-between gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleSection(section.h2Block.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
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
                          {allBlocksInSection.map(({ block, index }) => (
                            <div key={block.id} className="border-b last:border-b-0 px-4 py-3">
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
                                <p className={`font-medium mb-2 ${block.type === "h2" ? "text-lg" : "text-base"}`}>
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
                                  <Textarea
                                    value={editingHtml}
                                    onChange={(e) => setEditingHtml(e.target.value)}
                                    className="font-mono text-xs min-h-[200px]"
                                    rows={12}
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
                          ))}
                        </div>
                      )}
                    </Card>
                  );
                })}
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
                        {block.heading && (
                          <>
                            {block.type === "h2" ? (
                              <h2>{block.heading}</h2>
                            ) : block.type === "h3" ? (
                              <h3>{block.heading}</h3>
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

          {/* Meta description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Meta description</CardTitle>
            </CardHeader>
            <CardContent>
              {article.meta_description ? (
                <div className="space-y-2">
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
            </CardContent>
          </Card>

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

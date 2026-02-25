"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type {
  Article,
  ContentBlock,
  PipelineRun,
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

export default function ArticleDetailPage() {
  const params = useParams();
  const articleId = params.articleId as string;
  const { toast } = useToast();

  const [article, setArticle] = useState<ArticleWithRelations | null>(null);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
      const res = await fetch(`/api/articles/${articleId}/${endpoint}`, {
        method: "POST",
      });
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
    setActionLoading(`block-${blockId}`);
    try {
      const res = await fetch(`/api/articles/${articleId}/write-block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block_id: blockId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur");
      }
      toast({
        title: "Bloc en cours de redaction",
        description: "La redaction du bloc a ete lancee.",
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

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
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
                <Button
                  onClick={() =>
                    runPipelineAction("write-all", "Redaction")
                  }
                  disabled={!!actionLoading}
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
                disabled={!!actionLoading}
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
            {article.status === "media" && (
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
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {blocks.length} blocs - {writtenBlocks.length} ecrits,{" "}
                  {pendingBlocks.length} en attente
                </p>
              </div>
              {blocks.map((block, index) => (
                <Card key={block.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={
                              BLOCK_TYPE_COLORS[block.type] ?? ""
                            }
                          >
                            {BLOCK_TYPE_LABELS[block.type] ?? block.type}
                          </Badge>
                          <Badge
                            variant={
                              block.status === "written"
                                ? "default"
                                : block.status === "approved"
                                ? "default"
                                : "secondary"
                            }
                            className={
                              block.status === "written"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : block.status === "approved"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : ""
                            }
                          >
                            {BLOCK_STATUS_LABELS[block.status] ??
                              block.status}
                          </Badge>
                          {block.word_count > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {block.word_count} mots
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            #{index + 1}
                          </span>
                        </div>

                        {block.heading && (
                          <p className="font-medium">{block.heading}</p>
                        )}

                        {block.status !== "pending" &&
                          block.content_html && (
                            <div
                              className="text-sm text-muted-foreground line-clamp-3 prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{
                                __html: block.content_html.substring(
                                  0,
                                  300
                                ),
                              }}
                            />
                          )}
                      </div>

                      {/* Write button for pending blocks */}
                      {block.status === "pending" &&
                        (article.status === "writing" ||
                          article.status === "planning") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => writeBlock(block.id)}
                            disabled={!!actionLoading}
                          >
                            {actionLoading === `block-${block.id}` ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <PenLine className="mr-1 h-3 w-3" />
                            )}
                            Ecrire ce bloc
                          </Button>
                        )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
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

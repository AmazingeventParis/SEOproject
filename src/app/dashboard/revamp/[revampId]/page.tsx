"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowLeft,
  Edit3,
  Trash2,
  Plus,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Link as LinkIcon,
  Upload,
  Eye,
  MousePointer,
  TrendingUp,
} from "lucide-react";

interface RevampDetail {
  id: string;
  site_id: string;
  article_id: string | null;
  wp_post_id: number;
  wp_url: string;
  original_title: string;
  original_keyword: string;
  page_builder: string;
  status: string;
  gsc_data: {
    totalClicks: number;
    totalImpressions: number;
    avgCtr: number;
    avgPosition: number;
    topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
    opportunityKeywords: { query: string; impressions: number; position: number; opportunityScore: number }[];
  } | null;
  serp_comparison: {
    competitors: { url: string; title: string; headings: string[]; wordCount: number }[];
    missingTopics: string[];
    outdatedSections: string[];
    strengthsToKeep: string[];
  } | null;
  audit: {
    overallScore: number;
    blocksToKeep: { blockIndex: number; heading: string | null; reason: string }[];
    blocksToDelete: { blockIndex: number; heading: string | null; reason: string }[];
    blocksToRewrite: { blockIndex: number; heading: string | null; reason: string; directive: string }[];
    newSectionsToAdd: { heading: string; type: string; directive: string; keyIdeas: string[] }[];
    preservedLinks: { url: string; anchorText: string; isInternal: boolean }[];
    suggestedTitle: string | null;
    suggestedMetaDescription: string | null;
  } | null;
  original_blocks: { heading?: string; type: string; word_count: number; content_html: string }[];
  new_blocks: { heading?: string; type: string; word_count: number; status: string; content_html: string }[] | null;
  preserved_links: { url: string; anchor: string; isInternal: boolean }[];
  error: string | null;
  created_at: string;
}

export default function RevampDetailPage() {
  const params = useParams();
  const router = useRouter();
  const revampId = params.revampId as string;

  const [revamp, setRevamp] = useState<RevampDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRevamp = useCallback(async () => {
    try {
      const res = await fetch(`/api/revamp?siteId=all`);
      const data = await res.json();
      // Find our revamp in the list (we need a dedicated endpoint, but for now filter)
      // Actually, let's use a dedicated fetch
      // Since we don't have a GET /api/revamp/[id], get all and filter
      const allRevamps = data.revamps || [];
      const found = allRevamps.find((r: RevampDetail) => r.id === revampId);
      if (found) {
        setRevamp(found);
      } else {
        // Try fetching from all sites
        const sitesRes = await fetch("/api/sites");
        const sitesData = await sitesRes.json();
        const allSites = sitesData.sites || sitesData || [];
        for (const site of allSites) {
          const siteRes = await fetch(`/api/revamp?siteId=${site.id}`);
          const siteData = await siteRes.json();
          const siteRevamp = (siteData.revamps || []).find((r: RevampDetail) => r.id === revampId);
          if (siteRevamp) {
            setRevamp(siteRevamp);
            break;
          }
        }
      }
    } catch {
      setError("Erreur lors du chargement du revamp");
    } finally {
      setLoading(false);
    }
  }, [revampId]);

  useEffect(() => {
    fetchRevamp();
  }, [fetchRevamp]);

  const handleApprove = async () => {
    setActionLoading("approve");
    setError(null);
    try {
      const res = await fetch(`/api/revamp/${revampId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRevamp();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerate = async () => {
    setActionLoading("generate");
    setError(null);
    try {
      const res = await fetch(`/api/revamp/${revampId}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRevamp();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handlePush = async () => {
    setActionLoading("push");
    setError(null);
    try {
      const res = await fetch(`/api/revamp/${revampId}/push`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRevamp();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!revamp) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Revamp non trouve</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.push("/dashboard/revamp")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Retour
        </Button>
      </div>
    );
  }

  const scoreColor =
    (revamp.audit?.overallScore ?? 0) >= 70 ? "text-green-500" :
    (revamp.audit?.overallScore ?? 0) >= 40 ? "text-yellow-500" :
    "text-red-500";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/revamp")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold truncate">{revamp.original_title}</h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
            <span>{revamp.original_keyword}</span>
            <Badge variant="outline">{revamp.page_builder}</Badge>
            <a href={revamp.wp_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
              Voir sur WP <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {revamp.status === "analyzed" && (
            <Button onClick={handleApprove} disabled={!!actionLoading}>
              {actionLoading === "approve" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Approuver le plan
            </Button>
          )}
          {(revamp.status === "approved" || revamp.status === "failed") && (
            <Button onClick={handleGenerate} disabled={!!actionLoading}>
              {actionLoading === "generate" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Generer le contenu
            </Button>
          )}
          {revamp.status === "generated" && (
            <Button onClick={handlePush} disabled={!!actionLoading}>
              {actionLoading === "push" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Pusher sur WordPress
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* GSC Metrics */}
      {revamp.gsc_data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <MousePointer className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">Clics</span>
              </div>
              <p className="text-2xl font-bold mt-1">{revamp.gsc_data.totalClicks}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-purple-500" />
                <span className="text-sm text-muted-foreground">Impressions</span>
              </div>
              <p className="text-2xl font-bold mt-1">{revamp.gsc_data.totalImpressions}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">CTR moyen</span>
              </div>
              <p className="text-2xl font-bold mt-1">{(revamp.gsc_data.avgCtr * 100).toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                <span className="text-sm text-muted-foreground">Position moy.</span>
              </div>
              <p className="text-2xl font-bold mt-1">{revamp.gsc_data.avgPosition.toFixed(1)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Audit Summary */}
        {revamp.audit && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Audit IA
                <span className={`text-2xl font-bold ${scoreColor}`}>
                  {revamp.audit.overallScore}/100
                </span>
              </CardTitle>
              <CardDescription>Plan de mise a jour genere par l&apos;IA</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Blocks to keep */}
              {revamp.audit.blocksToKeep.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    A conserver ({revamp.audit.blocksToKeep.length})
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {revamp.audit.blocksToKeep.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-muted-foreground">
                        <span className="shrink-0 text-green-500">&#10003;</span>
                        <span><strong>{b.heading || `Bloc ${b.blockIndex}`}</strong> — {b.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Blocks to delete */}
              {revamp.audit.blocksToDelete.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Trash2 className="h-4 w-4 text-red-500" />
                    A supprimer ({revamp.audit.blocksToDelete.length})
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {revamp.audit.blocksToDelete.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-muted-foreground">
                        <span className="shrink-0 text-red-500">&#10007;</span>
                        <span><strong>{b.heading || `Bloc ${b.blockIndex}`}</strong> — {b.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Blocks to rewrite */}
              {revamp.audit.blocksToRewrite.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Edit3 className="h-4 w-4 text-yellow-500" />
                    A reecrire ({revamp.audit.blocksToRewrite.length})
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {revamp.audit.blocksToRewrite.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 text-muted-foreground">
                        <span className="shrink-0 text-yellow-500">&#9998;</span>
                        <span><strong>{b.heading || `Bloc ${b.blockIndex}`}</strong> — {b.directive}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* New sections */}
              {revamp.audit.newSectionsToAdd.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Plus className="h-4 w-4 text-blue-500" />
                    Nouvelles sections ({revamp.audit.newSectionsToAdd.length})
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {revamp.audit.newSectionsToAdd.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-muted-foreground">
                        <span className="shrink-0 text-blue-500">+</span>
                        <span><strong>[{s.type.toUpperCase()}] {s.heading}</strong> — {s.directive}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested title */}
              {revamp.audit.suggestedTitle && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-sm font-medium">Titre suggere :</p>
                  <p className="text-sm mt-1">{revamp.audit.suggestedTitle}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* SERP Comparison */}
        {revamp.serp_comparison && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Comparaison SERP</CardTitle>
              <CardDescription>Votre article vs les top resultats Google</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Missing topics */}
              {revamp.serp_comparison.missingTopics.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-red-600 mb-2">
                    Sujets manquants ({revamp.serp_comparison.missingTopics.length})
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {revamp.serp_comparison.missingTopics.map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <AlertTriangle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Outdated */}
              {revamp.serp_comparison.outdatedSections.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-yellow-600 mb-2">
                    Sections obsoletes ({revamp.serp_comparison.outdatedSections.length})
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {revamp.serp_comparison.outdatedSections.map((s, i) => (
                      <li key={i}>&#8226; {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Strengths */}
              {revamp.serp_comparison.strengthsToKeep.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-green-600 mb-2">
                    Points forts a garder ({revamp.serp_comparison.strengthsToKeep.length})
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {revamp.serp_comparison.strengthsToKeep.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Top queries */}
              {revamp.gsc_data && revamp.gsc_data.topQueries.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Top requetes GSC</h4>
                  <div className="space-y-1">
                    {revamp.gsc_data.topQueries.slice(0, 8).map((q, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                        <span className="flex-1 truncate">{q.query}</span>
                        <span className="text-muted-foreground">{q.clicks} clics</span>
                        <span className="text-muted-foreground">pos {q.position.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Preserved Links */}
      {revamp.preserved_links.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              Liens preserves ({revamp.preserved_links.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {revamp.preserved_links.map((link, i) => (
                <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border">
                  <Badge variant={link.isInternal ? "default" : "outline"} className="shrink-0 text-xs">
                    {link.isInternal ? "Interne" : "Externe"}
                  </Badge>
                  <span className="truncate text-muted-foreground" title={link.url}>
                    {link.anchor || link.url}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Blocks Preview */}
      {revamp.new_blocks && revamp.new_blocks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Nouveau contenu ({revamp.new_blocks.length} blocs)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revamp.new_blocks.map((block, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded border">
                  <Badge variant={
                    block.status === "written" ? "default" :
                    block.status === "pending" ? "secondary" :
                    "outline"
                  }>
                    {block.status}
                  </Badge>
                  <span className="text-sm font-medium">
                    [{block.type.toUpperCase()}] {block.heading || "(intro)"}
                  </span>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {block.word_count} mots
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Search,
  Eye,
  MousePointer,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
} from "lucide-react";

interface Site {
  id: string;
  name: string;
  domain: string;
  gsc_property: string | null;
}

interface CandidateKeyword {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface RevampCandidate {
  wpPostId: number;
  wpUrl: string;
  title: string;
  slug: string;
  gscMetrics: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  } | null;
  revampScore: number;
  pageBuilder: string;
  topKeywords: CandidateKeyword[];
  bestKeyword: string | null;
  searchIntent: string | null;
  strengths: string[];
  weaknesses: string[];
}

interface RevampProject {
  id: string;
  wp_post_id: number;
  wp_url: string;
  original_title: string;
  original_keyword: string;
  page_builder: string;
  status: string;
  gsc_data: { totalClicks: number; totalImpressions: number; avgCtr: number; avgPosition: number } | null;
  audit: { overallScore: number } | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: "bg-gray-500" },
  analyzing: { label: "Analyse...", color: "bg-blue-500" },
  analyzed: { label: "Analyse", color: "bg-yellow-500" },
  approved: { label: "Approuve", color: "bg-indigo-500" },
  generating: { label: "Generation...", color: "bg-purple-500" },
  generated: { label: "Genere", color: "bg-emerald-500" },
  pushing: { label: "Push WP...", color: "bg-orange-500" },
  completed: { label: "Termine", color: "bg-green-500" },
  failed: { label: "Erreur", color: "bg-red-500" },
};

const INTENT_LABELS: Record<string, { label: string; color: string }> = {
  traffic: { label: "Traffic", color: "bg-blue-100 text-blue-700" },
  review: { label: "Avis", color: "bg-purple-100 text-purple-700" },
  comparison: { label: "Comparatif", color: "bg-orange-100 text-orange-700" },
  informational: { label: "Info", color: "bg-cyan-100 text-cyan-700" },
  lead_gen: { label: "Lead", color: "bg-pink-100 text-pink-700" },
  discover: { label: "Decouverte", color: "bg-emerald-100 text-emerald-700" },
};

export default function RevampPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [candidates, setCandidates] = useState<RevampCandidate[]>([]);
  const [revamps, setRevamps] = useState<RevampProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCandidate, setExpandedCandidate] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data) => {
        const sitesData = data.sites || data || [];
        setSites(sitesData);
        if (sitesData.length > 0 && !selectedSiteId) {
          setSelectedSiteId(sitesData[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const fetchRevamps = useCallback(async () => {
    if (!selectedSiteId) return;
    try {
      const res = await fetch(`/api/revamp?siteId=${selectedSiteId}`);
      const data = await res.json();
      setRevamps(data.revamps || []);
    } catch { /* ignore */ }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchRevamps();
  }, [fetchRevamps]);

  const scanCandidates = async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const res = await fetch(`/api/revamp/candidates?siteId=${selectedSiteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCandidates(data.candidates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const analyzeCandidate = async (candidate: RevampCandidate) => {
    setAnalyzing(candidate.wpPostId);
    setError(null);
    try {
      const res = await fetch("/api/revamp/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: selectedSiteId,
          wpPostId: candidate.wpPostId,
          keyword: candidate.bestKeyword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchRevamps();
      setCandidates((prev) => prev.filter((c) => c.wpPostId !== candidate.wpPostId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(null);
    }
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Revamp Engine</h2>
          <p className="text-muted-foreground">
            Identifiez et mettez a jour vos articles WordPress sous-performants
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Choisir un site" />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={scanCandidates} disabled={loading || !selectedSiteId || !selectedSite?.gsc_property}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Scanner
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* Active Revamp Projects */}
      {revamps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Projets de revamp</CardTitle>
            <CardDescription>Vos mises a jour en cours et terminees</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {revamps.map((revamp) => {
                const statusInfo = STATUS_LABELS[revamp.status] || { label: revamp.status, color: "bg-gray-500" };
                return (
                  <div key={revamp.id} className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{revamp.original_title}</span>
                        <Badge variant="outline" className="shrink-0 text-xs">{revamp.page_builder}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{revamp.original_keyword}</span>
                        {revamp.gsc_data && (
                          <>
                            <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{revamp.gsc_data.totalClicks} clics</span>
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{revamp.gsc_data.totalImpressions} imp.</span>
                          </>
                        )}
                        {revamp.audit && <span>Score: {revamp.audit.overallScore}/100</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className={`${statusInfo.color} text-white`}>{statusInfo.label}</Badge>
                      {revamp.error && <span className="text-xs text-red-500 max-w-[200px] truncate" title={revamp.error}>{revamp.error}</span>}
                      {(revamp.status === "analyzed" || revamp.status === "approved" || revamp.status === "generated") && (
                        <Link href={`/dashboard/revamp/${revamp.id}`}>
                          <Button variant="outline" size="sm"><ArrowRight className="h-4 w-4" /></Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Candidates */}
      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Articles a revamper ({candidates.length})</CardTitle>
            <CardDescription>Classes par potentiel d&apos;amelioration. Cliquez sur un article pour voir le detail.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const isAnalyzing = analyzing === candidate.wpPostId;
                const alreadyRevamped = revamps.some((r) => r.wp_post_id === candidate.wpPostId);
                const isExpanded = expandedCandidate === candidate.wpPostId;
                const scoreColor = candidate.revampScore >= 60 ? "text-red-500" : candidate.revampScore >= 35 ? "text-yellow-500" : "text-green-500";
                const intentInfo = candidate.searchIntent ? INTENT_LABELS[candidate.searchIntent] : null;

                return (
                  <div key={candidate.wpPostId} className="rounded-lg border hover:bg-muted/50 transition-colors">
                    {/* Main row */}
                    <div
                      className="flex items-center gap-4 p-3 cursor-pointer"
                      onClick={() => setExpandedCandidate(isExpanded ? null : candidate.wpPostId)}
                    >
                      {/* Score */}
                      <div className="flex flex-col items-center w-14 shrink-0">
                        <span className={`text-xl font-bold ${scoreColor}`}>{candidate.revampScore}</span>
                        <span className="text-[10px] text-muted-foreground uppercase">Score</span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{candidate.title}</span>
                          {intentInfo && (
                            <Badge variant="secondary" className={`${intentInfo.color} text-xs shrink-0`}>
                              {intentInfo.label}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                          {candidate.bestKeyword && (
                            <span className="flex items-center gap-1">
                              <Target className="h-3 w-3" />
                              {candidate.bestKeyword}
                            </span>
                          )}
                          {candidate.gscMetrics && (
                            <>
                              <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{candidate.gscMetrics.clicks}</span>
                              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{candidate.gscMetrics.impressions}</span>
                              <span>CTR {(candidate.gscMetrics.ctr * 100).toFixed(1)}%</span>
                              <span>Pos. {candidate.gscMetrics.position.toFixed(1)}</span>
                            </>
                          )}
                          {!candidate.gscMetrics && <span className="text-yellow-600">Pas de donnees GSC</span>}
                        </div>

                        {/* Quick strengths/weaknesses inline */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {candidate.strengths.slice(0, 2).map((s, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-xs text-green-600">
                              <TrendingUp className="h-3 w-3" />{s}
                            </span>
                          ))}
                          {candidate.weaknesses.slice(0, 2).map((w, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-xs text-red-500">
                              <TrendingDown className="h-3 w-3" />{w}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Action */}
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        {alreadyRevamped ? (
                          <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />Deja analyse</Badge>
                        ) : (
                          <Button variant="default" size="sm" onClick={() => analyzeCandidate(candidate)} disabled={isAnalyzing}>
                            {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                            Analyser
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t px-4 py-3 bg-muted/30 space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                          <a href={candidate.wpUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                            {candidate.wpUrl} <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>

                        {/* Top Keywords */}
                        {candidate.topKeywords.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                              <Target className="h-4 w-4" /> Mots-cles principaux
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                              {candidate.topKeywords.map((kw, i) => (
                                <div key={i} className="flex items-center gap-3 text-sm py-1 px-2 rounded bg-background">
                                  <span className="text-muted-foreground w-4">{i + 1}.</span>
                                  <span className="flex-1 font-medium truncate">{kw.query}</span>
                                  <span className="text-muted-foreground text-xs">{kw.impressions} imp.</span>
                                  <span className="text-muted-foreground text-xs">pos {kw.position.toFixed(1)}</span>
                                  <span className="text-muted-foreground text-xs">CTR {(kw.ctr * 100).toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Strengths & Weaknesses */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {candidate.strengths.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold mb-1 text-green-600 flex items-center gap-1">
                                <TrendingUp className="h-4 w-4" /> Points forts
                              </h4>
                              <ul className="space-y-1 text-sm text-muted-foreground">
                                {candidate.strengths.map((s, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-500 shrink-0" />{s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {candidate.weaknesses.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold mb-1 text-red-500 flex items-center gap-1">
                                <TrendingDown className="h-4 w-4" /> Points faibles
                              </h4>
                              <ul className="space-y-1 text-sm text-muted-foreground">
                                {candidate.weaknesses.map((w, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <AlertTriangle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />{w}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && candidates.length === 0 && revamps.length === 0 && selectedSiteId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <RefreshCw className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Aucun revamp en cours</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Cliquez sur &quot;Scanner&quot; pour analyser vos articles WordPress via GSC
              et identifier ceux qui ont besoin d&apos;une mise a jour.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

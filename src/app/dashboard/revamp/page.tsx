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
} from "lucide-react";

interface Site {
  id: string;
  name: string;
  domain: string;
  gsc_property: string | null;
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

export default function RevampPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [candidates, setCandidates] = useState<RevampCandidate[]>([]);
  const [revamps, setRevamps] = useState<RevampProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch sites
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

  // Fetch revamp projects when site changes
  const fetchRevamps = useCallback(async () => {
    if (!selectedSiteId) return;
    try {
      const res = await fetch(`/api/revamp?siteId=${selectedSiteId}`);
      const data = await res.json();
      setRevamps(data.revamps || []);
    } catch {
      // Ignore
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchRevamps();
  }, [fetchRevamps]);

  // Scan for candidates
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

  // Analyze a specific candidate
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Refresh revamps list
      await fetchRevamps();

      // Remove from candidates
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
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
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
                  <div
                    key={revamp.id}
                    className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{revamp.original_title}</span>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {revamp.page_builder}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>{revamp.original_keyword}</span>
                        {revamp.gsc_data && (
                          <>
                            <span className="flex items-center gap-1">
                              <MousePointer className="h-3 w-3" />
                              {revamp.gsc_data.totalClicks} clics
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {revamp.gsc_data.totalImpressions} imp.
                            </span>
                          </>
                        )}
                        {revamp.audit && (
                          <span className="flex items-center gap-1">
                            Score: {revamp.audit.overallScore}/100
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge
                        variant="secondary"
                        className={`${statusInfo.color} text-white`}
                      >
                        {statusInfo.label}
                      </Badge>

                      {revamp.error && (
                        <span className="text-xs text-red-500 max-w-[200px] truncate" title={revamp.error}>
                          {revamp.error}
                        </span>
                      )}

                      {(revamp.status === "analyzed" || revamp.status === "approved" || revamp.status === "generated") && (
                        <Link href={`/dashboard/revamp/${revamp.id}`}>
                          <Button variant="outline" size="sm">
                            <ArrowRight className="h-4 w-4" />
                          </Button>
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
            <CardTitle className="text-lg">
              Articles a revamper ({candidates.length})
            </CardTitle>
            <CardDescription>
              Classes par score d&apos;urgence. Les articles avec le plus de potentiel d&apos;amelioration sont en haut.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const isAnalyzing = analyzing === candidate.wpPostId;
                const alreadyRevamped = revamps.some((r) => r.wp_post_id === candidate.wpPostId);
                const scoreColor =
                  candidate.revampScore >= 70 ? "text-red-500" :
                  candidate.revampScore >= 40 ? "text-yellow-500" :
                  "text-green-500";

                return (
                  <div
                    key={candidate.wpPostId}
                    className="flex items-center gap-4 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    {/* Score */}
                    <div className="flex flex-col items-center w-16 shrink-0">
                      <span className={`text-2xl font-bold ${scoreColor}`}>
                        {candidate.revampScore}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase">Score</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <a
                        href={candidate.wpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline truncate block"
                      >
                        {candidate.title}
                        <ExternalLink className="inline ml-1 h-3 w-3 text-muted-foreground" />
                      </a>
                      {candidate.gscMetrics && (
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MousePointer className="h-3 w-3" />
                            {candidate.gscMetrics.clicks} clics
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {candidate.gscMetrics.impressions} imp.
                          </span>
                          <span className="flex items-center gap-1">
                            CTR {(candidate.gscMetrics.ctr * 100).toFixed(1)}%
                          </span>
                          <span className="flex items-center gap-1">
                            Pos. {candidate.gscMetrics.position.toFixed(1)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      {alreadyRevamped ? (
                        <Badge variant="secondary">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Deja analyse
                        </Badge>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => analyzeCandidate(candidate)}
                          disabled={isAnalyzing}
                        >
                          {isAnalyzing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          Analyser
                        </Button>
                      )}
                    </div>
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

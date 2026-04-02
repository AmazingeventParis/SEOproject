"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AddOpportunityDialog } from "@/components/netlinking/add-opportunity-dialog";
import { CsvImportDialog } from "@/components/netlinking/csv-import-dialog";
import {
  Shield, TrendingUp, Target, Brain, FileText,
  Sparkles, ExternalLink, Trash2, Copy, Zap, CheckCircle,
} from "lucide-react";

interface Site { id: string; name: string; domain: string; niche: string | null }

interface Opportunity {
  id: string; site_id: string; vendor_domain: string; vendor_url: string | null;
  tf: number; cf: number; da: number; dr: number; organic_traffic: number; price: number;
  target_page: string | null; target_keyword: string | null; niche: string | null;
  roi_score: number; power_score: number; keyword_score: number; safety_score: number;
  topical_relevance: number; overall_score: number;
  ai_analysis: Record<string, unknown> | null;
  anchor_suggestions: Record<string, unknown>[] | null;
  generated_article: Record<string, unknown> | null;
  vendor_keywords: Record<string, unknown>[];
  status: string; notes: string | null; created_at: string;
}

interface Purchase {
  id: string; vendor_domain: string; price_paid: number; currency: string;
  target_page: string | null; anchor_text: string | null; anchor_type: string | null;
  published_url: string | null; do_follow: boolean; status: string;
  ordered_at: string; published_at: string | null;
}

interface Profile {
  id: string; tf: number; cf: number; da: number; dr: number;
  referring_domains: number; total_backlinks: number; organic_traffic: number;
  organic_keywords: number; snapshot_date: string;
}

interface GapResult {
  summary: string; strengths: string[]; weaknesses: string[]; priorities: string[];
}

interface RecommendedContent {
  type: string; topic_suggestion: string; target_keyword: string;
  target_page: string; anchor_type: string; anchor_text_suggestion: string;
}

interface MetricsAnalysis {
  tf_cf_verdict: string; semrush_verdict: string; price_verdict: string;
}

interface RankingItem {
  vendor_domain: string; rank: number; score: number; label: string;
  skip: boolean; verdict: string; justification: string;
  metrics_analysis: MetricsAnalysis;
  recommended_content: RecommendedContent; risks: string[];
}

interface RecommendStrategy {
  buy_order: string[]; skip_list: string[]; total_budget: number;
  expected_impact: string; keywords_to_avoid: string[]; missing_topics: string[];
}

interface Recommendation {
  ranking: RankingItem[];
  strategy: RecommendStrategy;
}

function scoreBadge(score: number, label: string) {
  const color = score >= 70 ? "bg-green-100 text-green-800" : score >= 40 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{label}: {score}</span>;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    new: "bg-gray-100 text-gray-700",
    analyzed: "bg-blue-100 text-blue-700",
    approved: "bg-purple-100 text-purple-700",
    article_generated: "bg-indigo-100 text-indigo-700",
    purchased: "bg-green-100 text-green-700",
    published: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-700",
    ordered: "bg-blue-100 text-blue-700",
    writing: "bg-yellow-100 text-yellow-700",
    verified: "bg-emerald-100 text-emerald-700",
    lost: "bg-red-100 text-red-700",
  };
  return <Badge className={colors[status] || "bg-gray-100"}>{status}</Badge>;
}

export default function NetlinkingPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gap, setGap] = useState<GapResult | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({ tf: "", cf: "", da: "", referring_domains: "", total_backlinks: "", organic_traffic: "", organic_keywords: "" });
  const { toast } = useToast();

  // Load sites
  useEffect(() => {
    fetch("/api/sites").then(r => r.json()).then(data => {
      setSites(data || []);
      if (data?.length > 0) setSelectedSite(data[0].id);
    });
  }, []);

  // Load data when site changes
  const loadData = useCallback(async () => {
    if (!selectedSite) return;
    const [oppRes, purchRes, profRes] = await Promise.all([
      fetch(`/api/netlinking/opportunities?site_id=${selectedSite}`),
      fetch(`/api/netlinking/purchases?site_id=${selectedSite}`),
      fetch(`/api/netlinking/profiles?site_id=${selectedSite}`),
    ]);
    const [oppData, purchData, profData] = await Promise.all([oppRes.json(), purchRes.json(), profRes.json()]);
    setOpportunities(oppData || []);
    setPurchases(purchData || []);
    const latestProfile = profData?.[0] || null;
    setProfile(latestProfile);
    if (latestProfile) {
      setProfileForm({
        tf: String(latestProfile.tf || ""),
        cf: String(latestProfile.cf || ""),
        da: String(latestProfile.da || ""),
        referring_domains: String(latestProfile.referring_domains || ""),
        total_backlinks: String(latestProfile.total_backlinks || ""),
        organic_traffic: String(latestProfile.organic_traffic || ""),
        organic_keywords: String(latestProfile.organic_keywords || ""),
      });
    }
    setGap(null);
  }, [selectedSite]);

  useEffect(() => { loadData(); }, [loadData]);

  // Gap analysis
  const runGapAnalysis = async () => {
    setGapLoading(true);
    try {
      const res = await fetch("/api/netlinking/gap-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGap(data.gap_analysis);
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setGapLoading(false);
    }
  };

  // Analyze opportunity
  const analyzeOpportunity = async (id: string) => {
    setAnalyzingId(id);
    try {
      const res = await fetch(`/api/netlinking/opportunities/${id}/analyze`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      toast({ title: "Analyse terminee" });
      loadData();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setAnalyzingId(null);
    }
  };

  // Generate article
  const generateArticle = async (id: string) => {
    setGeneratingId(id);
    try {
      const res = await fetch(`/api/netlinking/opportunities/${id}/generate-article`, { method: "POST" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      toast({ title: "Article genere" });
      loadData();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setGeneratingId(null);
    }
  };

  // Delete opportunity
  const deleteOpportunity = async (id: string) => {
    if (!confirm("Supprimer cette opportunite ?")) return;
    await fetch(`/api/netlinking/opportunities/${id}`, { method: "DELETE" });
    loadData();
  };

  // Save profile
  const saveProfile = async () => {
    if (!selectedSite) {
      toast({ title: "Erreur", description: "Selectionnez un site d'abord", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        site_id: selectedSite,
        tf: Number(profileForm.tf) || 0,
        cf: Number(profileForm.cf) || 0,
        da: Number(profileForm.da) || 0,
        referring_domains: Number(profileForm.referring_domains) || 0,
        total_backlinks: Number(profileForm.total_backlinks) || 0,
        organic_traffic: Number(profileForm.organic_traffic) || 0,
        organic_keywords: Number(profileForm.organic_keywords) || 0,
      };
      console.log("[netlinking] saveProfile payload:", payload);
      const res = await fetch("/api/netlinking/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      console.log("[netlinking] saveProfile response:", res.status, JSON.stringify(json));
      if (!res.ok) throw new Error(json.error + (json.details ? " — " + JSON.stringify(json.details) : ""));
      toast({ title: "Profil sauvegarde" });
      loadData();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    }
  };

  // Validate purchase — create purchase from opportunity
  const validatePurchase = async (opp: Opportunity) => {
    if (!confirm(`Valider l'achat du lien sur ${opp.vendor_domain} pour ${opp.price}€ ?`)) return;
    try {
      const res = await fetch("/api/netlinking/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opp.id,
          site_id: opp.site_id,
          vendor_domain: opp.vendor_domain,
          price_paid: opp.price,
          currency: "EUR",
          target_page: opp.target_page,
          anchor_text: opp.target_keyword,
          anchor_type: "broad",
          do_follow: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Achat valide", description: `${opp.vendor_domain} — ${opp.price}€` });
      loadData();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    }
  };

  // Apply recommendation to opportunity (set target_keyword + target_page)
  const applyRecommendation = async (vendorDomain: string, targetKeyword: string, targetPage: string) => {
    const opp = opportunities.find(o => o.vendor_domain === vendorDomain);
    if (!opp) return;
    try {
      const res = await fetch(`/api/netlinking/opportunities/${opp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_keyword: targetKeyword, target_page: targetPage }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Recommandation appliquee", description: `${vendorDomain} → "${targetKeyword}"` });
      loadData();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    }
  };

  // AI Recommendation
  const runRecommendation = async () => {
    setRecommendLoading(true);
    setRecommendation(null);
    try {
      const res = await fetch("/api/netlinking/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecommendation(data);
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Erreur", variant: "destructive" });
    } finally {
      setRecommendLoading(false);
    }
  };

  // Update purchase status
  const updatePurchaseStatus = async (id: string, status: string) => {
    await fetch(`/api/netlinking/purchases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadData();
  };

  const currentSite = sites.find(s => s.id === selectedSite);
  const totalSpent = purchases.reduce((s, p) => s + p.price_paid, 0);
  const avgPrice = purchases.length > 0 ? totalSpent / purchases.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Link Intelligence</h1>
          <p className="text-muted-foreground">Gestion et optimisation du netlinking</p>
        </div>
        <Select value={selectedSite} onValueChange={setSelectedSite}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Selectionner un site" />
          </SelectTrigger>
          <SelectContent>
            {sites.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name} ({s.domain})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Trust Flow", value: profile?.tf ?? "—", icon: Shield, color: (profile?.tf || 0) >= 30 ? "text-green-600" : "text-red-600" },
          { label: "Citation Flow", value: profile?.cf ?? "—", icon: TrendingUp, color: "text-blue-600" },
          { label: "Domain Authority", value: profile?.da ?? "—", icon: Target, color: (profile?.da || 0) >= 30 ? "text-green-600" : "text-yellow-600" },
          { label: "Trafic organique", value: profile?.organic_traffic?.toLocaleString() ?? "—", icon: Sparkles, color: "text-purple-600" },
          { label: "Mots-cles", value: profile?.organic_keywords?.toLocaleString() ?? "—", icon: FileText, color: "text-orange-600" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
                <kpi.icon className={`w-8 h-8 ${kpi.color} opacity-30`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="opportunities">
        <TabsList>
          <TabsTrigger value="opportunities">Opportunites ({opportunities.length})</TabsTrigger>
          <TabsTrigger value="articles">Articles generes</TabsTrigger>
          <TabsTrigger value="purchases">Achats ({purchases.length})</TabsTrigger>
          <TabsTrigger value="profile">Profil & Gap</TabsTrigger>
        </TabsList>

        {/* === TAB: Opportunities === */}
        <TabsContent value="opportunities" className="space-y-4">
          <div className="flex items-center gap-2">
            <AddOpportunityDialog siteId={selectedSite} onCreated={loadData} />
            <Button size="sm" variant="outline" onClick={runGapAnalysis} disabled={gapLoading}>
              <Brain className="w-4 h-4 mr-1" />
              {gapLoading ? "Analyse..." : "Gap Analysis IA"}
            </Button>
            {opportunities.length > 0 && (
              <Button size="sm" onClick={runRecommendation} disabled={recommendLoading} className="bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700">
                <Zap className="w-4 h-4 mr-1" />
                {recommendLoading ? "Analyse en cours..." : "Recommandation IA"}
              </Button>
            )}
          </div>

          {gap && (
            <Card className="border-purple-200 bg-purple-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Brain className="w-4 h-4" /> Analyse de Gap IA</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <p>{gap.summary}</p>
                {gap.strengths.length > 0 && (
                  <div>
                    <p className="font-semibold text-green-700">Forces :</p>
                    <ul className="list-disc pl-5">{gap.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {gap.weaknesses.length > 0 && (
                  <div>
                    <p className="font-semibold text-red-700">Faiblesses :</p>
                    <ul className="list-disc pl-5">{gap.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}
                {gap.priorities.length > 0 && (
                  <div>
                    <p className="font-semibold text-blue-700">Priorites :</p>
                    <ol className="list-decimal pl-5">{gap.priorities.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* AI Recommendation */}
          {recommendation && (
            <Card className="border-blue-200 bg-gradient-to-br from-blue-50/50 to-purple-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-purple-600" /> Recommandation IA</CardTitle>
                <CardDescription>Analyse croisee des opportunites et de vos mots-cles existants</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Ranking */}
                <div className="space-y-3">
                  {recommendation.ranking.map((item, idx) => {
                    const labelColors: Record<string, string> = {
                      pepite: "bg-emerald-600 text-white",
                      super: "bg-green-500 text-white",
                      correct: "bg-blue-500 text-white",
                      moyen: "bg-yellow-500 text-white",
                      a_eviter: "bg-red-600 text-white",
                    };
                    const labelEmojis: Record<string, string> = {
                      pepite: "💎", super: "🔥", correct: "✅", moyen: "😐", a_eviter: "🚫",
                    };
                    const cardBorder = item.skip
                      ? "border-red-300 bg-red-50/30 opacity-75"
                      : item.label === "pepite" ? "border-emerald-300 bg-emerald-50/50"
                      : item.label === "super" ? "border-green-300 bg-green-50/50"
                      : item.label === "correct" ? "border-blue-200 bg-blue-50/30"
                      : "border-gray-200 bg-white/50";

                    return (
                      <div key={idx} className={`p-3 rounded-lg border ${cardBorder}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${item.skip ? "bg-red-600 text-white" : item.rank === 1 ? "bg-green-600 text-white" : item.rank === 2 ? "bg-yellow-500 text-white" : "bg-gray-400 text-white"}`}>
                              {item.skip ? "✕" : `#${item.rank}`}
                            </span>
                            <span className={`font-semibold ${item.skip ? "line-through text-muted-foreground" : ""}`}>{item.vendor_domain}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${labelColors[item.label] || "bg-gray-500 text-white"}`}>
                              {labelEmojis[item.label] || ""} {item.label?.toUpperCase()}
                            </span>
                            <Badge variant={item.score >= 70 ? "default" : item.score >= 40 ? "secondary" : "destructive"}>{item.score}/100</Badge>
                          </div>
                          <span className="text-sm font-medium text-muted-foreground">{item.verdict}</span>
                        </div>

                        <p className="text-sm text-muted-foreground mb-2">{item.justification}</p>

                        {/* Metrics analysis */}
                        {item.metrics_analysis && (
                          <div className="flex flex-wrap gap-2 mb-2 text-xs">
                            <span className="px-2 py-1 rounded bg-gray-100">{item.metrics_analysis.tf_cf_verdict}</span>
                            <span className="px-2 py-1 rounded bg-gray-100">{item.metrics_analysis.semrush_verdict}</span>
                            <span className="px-2 py-1 rounded bg-gray-100">{item.metrics_analysis.price_verdict}</span>
                          </div>
                        )}

                        {!item.skip && (
                          <div className="grid md:grid-cols-2 gap-3 text-xs">
                            <div className="p-2 bg-white/80 rounded border">
                              <p className="font-semibold mb-1">Contenu recommande</p>
                              <p><span className="text-muted-foreground">Type :</span> {item.recommended_content.type}</p>
                              <p><span className="text-muted-foreground">Sujet :</span> {item.recommended_content.topic_suggestion}</p>
                              <p><span className="text-muted-foreground">Mot-cle :</span> <span className="font-medium text-purple-700">{item.recommended_content.target_keyword}</span></p>
                              <p><span className="text-muted-foreground">Page cible :</span> {item.recommended_content.target_page}</p>
                              <p><span className="text-muted-foreground">Ancre :</span> {item.recommended_content.anchor_type} — &quot;{item.recommended_content.anchor_text_suggestion}&quot;</p>
                              <Button size="sm" className="mt-2 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => applyRecommendation(item.vendor_domain, item.recommended_content.target_keyword, item.recommended_content.target_page)}>
                                <Zap className="w-3 h-3 mr-1" /> Appliquer cette reco
                              </Button>
                            </div>
                            {item.risks.length > 0 && (
                              <div className="p-2 bg-red-50/50 rounded border border-red-100">
                                <p className="font-semibold mb-1 text-red-700">Risques</p>
                                <ul className="list-disc pl-4 text-red-600">{item.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                              </div>
                            )}
                          </div>
                        )}

                        {item.skip && (
                          <div className="p-2 bg-red-100 rounded border border-red-200 text-xs text-red-700 font-medium">
                            🚫 Ce site ne merite pas l&apos;investissement — {item.risks.join(". ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Strategy */}
                <div className="p-3 rounded-lg border border-purple-200 bg-purple-50/30">
                  <p className="font-semibold text-sm mb-2 flex items-center gap-1"><Target className="w-4 h-4" /> Strategie globale</p>
                  <div className="grid md:grid-cols-2 gap-3 text-xs">
                    <div>
                      {recommendation.strategy.buy_order.length > 0 && (
                        <p><span className="font-medium">Ordre d&apos;achat :</span> {recommendation.strategy.buy_order.join(" → ")}</p>
                      )}
                      {recommendation.strategy.skip_list?.length > 0 && (
                        <p className="text-red-600"><span className="font-medium">A ne pas acheter :</span> {recommendation.strategy.skip_list.join(", ")}</p>
                      )}
                      <p><span className="font-medium">Budget recommande :</span> {recommendation.strategy.total_budget}€</p>
                      <p className="mt-1">{recommendation.strategy.expected_impact}</p>
                    </div>
                    <div>
                      {recommendation.strategy.missing_topics.length > 0 && (
                        <div>
                          <p className="font-medium text-green-700">Sujets non couverts a cibler :</p>
                          <ul className="list-disc pl-4">{recommendation.strategy.missing_topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
                        </div>
                      )}
                      {recommendation.strategy.keywords_to_avoid.length > 0 && (
                        <div className="mt-1">
                          <p className="font-medium text-red-600">Mots-cles a eviter (deja positionnes) :</p>
                          <p className="text-muted-foreground">{recommendation.strategy.keywords_to_avoid.join(", ")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Opportunities table */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Vendeur</th>
                  <th className="text-center p-3 font-medium">TF</th>
                  <th className="text-center p-3 font-medium">CF</th>
                  <th className="text-center p-3 font-medium">DA</th>
                  <th className="text-right p-3 font-medium">Trafic</th>
                  <th className="text-right p-3 font-medium">Prix</th>
                  <th className="text-center p-3 font-medium">Score</th>
                  <th className="text-center p-3 font-medium">Statut</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opp) => {
                  const analysis = opp.ai_analysis as Record<string, unknown> | null;
                  const safetyAlert = (analysis?.safety_alert as string) || null;
                  const labels = (analysis?.labels as string[]) || [];
                  const isExpanded = expandedRow === opp.id;
                  return (
                    <>
                      <tr key={opp.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedRow(isExpanded ? null : opp.id)}>
                        <td className="p-3">
                          <div className="font-medium">{opp.vendor_domain}</div>
                          {opp.target_keyword && <div className="text-xs text-muted-foreground">{opp.target_keyword}</div>}
                          {safetyAlert && <div className="text-xs text-red-600 mt-1">{safetyAlert.includes("ELEVE") ? "⛔" : "⚠️"} Alerte TF/CF</div>}
                        </td>
                        <td className="text-center p-3">{opp.tf}</td>
                        <td className="text-center p-3">{opp.cf}</td>
                        <td className="text-center p-3">{opp.da}</td>
                        <td className="text-right p-3">{opp.organic_traffic.toLocaleString()}</td>
                        <td className="text-right p-3 font-medium">{opp.price}€</td>
                        <td className="text-center p-3">
                          <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold ${
                            opp.overall_score >= 70 ? "bg-green-100 text-green-700" :
                            opp.overall_score >= 40 ? "bg-yellow-100 text-yellow-700" :
                            opp.overall_score > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
                          }`}>{opp.overall_score || "—"}</span>
                        </td>
                        <td className="text-center p-3">{statusBadge(opp.status)}</td>
                        <td className="text-right p-3">
                          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => analyzeOpportunity(opp.id)} disabled={analyzingId === opp.id} title="Analyser">
                              {analyzingId === opp.id ? "..." : <Brain className="w-4 h-4" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              if (!opp.target_page || !opp.target_keyword) {
                                toast({ title: "Mot-cle requis", description: "Lancez d'abord la Recommandation IA puis cliquez 'Appliquer cette reco' pour definir le mot-cle cible.", variant: "destructive" });
                                return;
                              }
                              generateArticle(opp.id);
                            }} disabled={generatingId === opp.id} title={opp.target_keyword ? `Generer article — ${opp.target_keyword}` : "Definissez d'abord le mot-cle cible"}>
                              {generatingId === opp.id ? "..." : <FileText className={`w-4 h-4 ${!opp.target_keyword ? "opacity-40" : ""}`} />}
                            </Button>
                            {opp.status !== "purchased" && (
                              <Button size="sm" variant="ghost" className="text-green-600" onClick={() => validatePurchase(opp)} title="Valider l'achat">
                                <CheckCircle className="w-4 h-4" />
                              </Button>
                            )}
                            <CsvImportDialog opportunityId={opp.id} vendorDomain={opp.vendor_domain} onImported={loadData} />
                            <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteOpportunity(opp.id)} title="Supprimer">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${opp.id}-detail`} className="bg-muted/20">
                          <td colSpan={9} className="p-4">
                            <div className="grid md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <p className="font-semibold text-sm">Scores detailles</p>
                                <div className="flex flex-wrap gap-2">
                                  {scoreBadge(opp.roi_score, "ROI")}
                                  {scoreBadge(opp.power_score, "Power")}
                                  {scoreBadge(opp.keyword_score, "Keyword")}
                                  {scoreBadge(opp.safety_score, "Safety")}
                                  {scoreBadge(opp.topical_relevance, "Topical")}
                                </div>
                                {labels.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {labels.map((l, i) => <Badge key={i} variant="secondary">{l}</Badge>)}
                                  </div>
                                )}
                                {safetyAlert && <p className="text-xs text-red-600 mt-2">{safetyAlert}</p>}
                                {!!analysis?.impact_simulation && (
                                  <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
                                    <p className="font-semibold">Simulation d&apos;impact :</p>
                                    <p>{(analysis.impact_simulation as Record<string, unknown>).rationale as string}</p>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2">
                                {opp.target_page && <p className="text-xs"><span className="font-semibold">Cible :</span> {opp.target_page}</p>}
                                {opp.niche && <p className="text-xs"><span className="font-semibold">Niche vendeur :</span> {opp.niche}</p>}
                                {!!analysis?.topical_rationale && <p className="text-xs"><span className="font-semibold">Pertinence :</span> {String(analysis.topical_rationale)}</p>}
                                {opp.vendor_keywords.length > 0 && (
                                  <p className="text-xs text-muted-foreground">{opp.vendor_keywords.length} mots-cles Semrush importes</p>
                                )}
                                {opp.notes && <p className="text-xs text-muted-foreground">Notes: {opp.notes}</p>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {opportunities.length === 0 && (
                  <tr><td colSpan={9} className="text-center p-8 text-muted-foreground">Aucune opportunite. Cliquez &quot;Ajouter&quot; pour commencer.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* === TAB: Generated Articles === */}
        <TabsContent value="articles" className="space-y-4">
          {opportunities.filter(o => o.generated_article).map((opp) => {
            const article = opp.generated_article as { title?: string; content_html?: string; word_count?: number; anchors?: { type: string; text: string; context_sentence: string }[] } | null;
            if (!article) return null;
            return (
              <Card key={opp.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{article.title || opp.vendor_domain}</CardTitle>
                      <CardDescription>Pour {opp.vendor_domain} — {article.word_count || 0} mots — Cible: {opp.target_keyword}</CardDescription>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => {
                      navigator.clipboard.writeText(article.content_html || "");
                      toast({ title: "Article copie dans le presse-papier" });
                    }}>
                      <Copy className="w-4 h-4 mr-1" /> Copier HTML
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {article.anchors && article.anchors.length > 0 && (
                    <div>
                      <p className="font-semibold text-sm mb-2">Variantes d&apos;ancres :</p>
                      <div className="space-y-2">
                        {article.anchors.map((a, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm p-2 bg-muted/30 rounded">
                            <Badge variant="outline" className="shrink-0">{a.type}</Badge>
                            <div>
                              <span className="font-medium text-purple-700">{a.text}</span>
                              <p className="text-xs text-muted-foreground mt-1" dangerouslySetInnerHTML={{ __html: a.context_sentence }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-muted-foreground">Voir l&apos;article complet</summary>
                    <div className="mt-2 prose prose-sm max-w-none border rounded p-4" dangerouslySetInnerHTML={{ __html: article.content_html || "" }} />
                  </details>
                </CardContent>
              </Card>
            );
          })}
          {opportunities.filter(o => o.generated_article).length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Aucun article genere. Analysez une opportunite puis cliquez sur l&apos;icone article.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* === TAB: Purchases === */}
        <TabsContent value="purchases" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total depense</p>
                <p className="text-2xl font-bold">{totalSpent.toFixed(0)}€</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Liens achetes</p>
                <p className="text-2xl font-bold">{purchases.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Prix moyen</p>
                <p className="text-2xl font-bold">{avgPrice.toFixed(0)}€</p>
              </CardContent>
            </Card>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Vendeur</th>
                  <th className="text-right p-3 font-medium">Prix</th>
                  <th className="text-left p-3 font-medium">Ancre</th>
                  <th className="text-center p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium">URL publiee</th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3 font-medium">{p.vendor_domain}</td>
                    <td className="p-3 text-right">{p.price_paid}€</td>
                    <td className="p-3">
                      {p.anchor_text && <span className="text-purple-700">{p.anchor_text}</span>}
                      {p.anchor_type && <Badge variant="outline" className="ml-1 text-xs">{p.anchor_type}</Badge>}
                    </td>
                    <td className="p-3 text-center">{statusBadge(p.status)}</td>
                    <td className="p-3">
                      {p.published_url && (
                        <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Voir
                        </a>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{new Date(p.ordered_at).toLocaleDateString("fr-FR")}</td>
                    <td className="p-3 text-right">
                      <Select value={p.status} onValueChange={(v) => updatePurchaseStatus(p.id, v)}>
                        <SelectTrigger className="h-8 w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["ordered", "writing", "published", "verified", "lost"].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">Aucun achat enregistre.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* === TAB: Profile & Gap === */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mettre a jour le profil de {currentSite?.domain || "..."}</CardTitle>
              <CardDescription>Entrez les metriques actuelles (Majestic, Ahrefs, Semrush)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div><Label>TF</Label><Input type="number" min={0} value={profileForm.tf} onChange={e => setProfileForm(prev => ({...prev, tf: e.target.value}))} placeholder="0" /></div>
                <div><Label>CF</Label><Input type="number" min={0} value={profileForm.cf} onChange={e => setProfileForm(prev => ({...prev, cf: e.target.value}))} placeholder="0" /></div>
                <div><Label>DA</Label><Input type="number" min={0} value={profileForm.da} onChange={e => setProfileForm(prev => ({...prev, da: e.target.value}))} placeholder="0" /></div>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div><Label>Domaines referents</Label><Input type="number" value={profileForm.referring_domains} onChange={e => setProfileForm(prev => ({...prev, referring_domains: e.target.value}))} placeholder={String(profile?.referring_domains || 0)} /></div>
                <div><Label>Total backlinks</Label><Input type="number" value={profileForm.total_backlinks} onChange={e => setProfileForm(prev => ({...prev, total_backlinks: e.target.value}))} placeholder={String(profile?.total_backlinks || 0)} /></div>
                <div><Label>Trafic organique</Label><Input type="number" value={profileForm.organic_traffic} onChange={e => setProfileForm(prev => ({...prev, organic_traffic: e.target.value}))} placeholder={String(profile?.organic_traffic || 0)} /></div>
                <div><Label>Mots-cles</Label><Input type="number" value={profileForm.organic_keywords} onChange={e => setProfileForm(prev => ({...prev, organic_keywords: e.target.value}))} placeholder={String(profile?.organic_keywords || 0)} /></div>
              </div>
              <Button onClick={saveProfile}>Sauvegarder le snapshot</Button>
            </CardContent>
          </Card>

          {profile && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dernier snapshot — {profile.snapshot_date}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div><p className="text-2xl font-bold text-green-600">{profile.tf}</p><p className="text-xs text-muted-foreground">TF</p></div>
                  <div><p className="text-2xl font-bold text-blue-600">{profile.cf}</p><p className="text-xs text-muted-foreground">CF</p></div>
                  <div><p className="text-2xl font-bold text-purple-600">{profile.da}</p><p className="text-xs text-muted-foreground">DA</p></div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { computeAllScores, classifyOpportunity, getSafetyAlert, simulateImpact } from "@/lib/netlinking/scoring";
import { computeTopicalRelevance } from "@/lib/netlinking/analyzer";
import type { VendorKeyword } from "@/lib/netlinking/types";

export const maxDuration = 60;

interface RouteContext {
  params: { id: string };
}

// POST /api/netlinking/opportunities/[id]/analyze — Run AI scoring
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();

  // Fetch opportunity
  const { data: opp, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .select("*, seo_sites!seo_link_opportunities_site_id_fkey(name, domain, niche)")
    .eq("id", params.id)
    .single();

  if (error || !opp) {
    return NextResponse.json({ error: "Opportunite non trouvee" }, { status: 404 });
  }

  const site = opp.seo_sites as { name: string; domain: string; niche: string | null } | null;
  const vendorKeywords = (opp.vendor_keywords || []) as VendorKeyword[];

  // Compute topical relevance via AI
  let topicalScore = 50;
  let topicalRationale = "";
  try {
    const topical = await computeTopicalRelevance({
      vendorDomain: opp.vendor_domain,
      vendorNiche: opp.niche,
      vendorTopKeywords: vendorKeywords.slice(0, 20).map((k: VendorKeyword) => k.keyword),
      siteNiche: site?.niche || "generaliste",
      targetKeyword: opp.target_keyword || "",
    });
    topicalScore = topical.score;
    topicalRationale = topical.rationale;
  } catch (e) {
    console.error("[netlinking] Topical relevance AI error:", e);
  }

  // Compute all scores
  const scores = computeAllScores({
    tf: opp.tf || 0,
    cf: opp.cf || 0,
    da: opp.da || 0,
    dr: opp.dr || 0,
    organic_traffic: opp.organic_traffic || 0,
    price: opp.price || 0,
    vendor_keywords: vendorKeywords,
    target_keyword: opp.target_keyword || "",
    topical_relevance_ai: topicalScore,
  });

  const labels = classifyOpportunity(scores);
  const safetyAlert = getSafetyAlert(opp.tf || 0, opp.cf || 0);
  const impact = simulateImpact(scores.overall, opp.price || 0, 15);

  const aiAnalysis = {
    scores,
    labels,
    safety_alert: safetyAlert,
    topical_rationale: topicalRationale,
    impact_simulation: impact,
    analyzed_at: new Date().toISOString(),
  };

  // Update opportunity with scores
  const { data: updated, error: updateError } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .update({
      roi_score: scores.roi,
      power_score: scores.power,
      keyword_score: scores.keyword,
      safety_score: scores.safety,
      topical_relevance: scores.topical,
      overall_score: scores.overall,
      ai_analysis: aiAnalysis,
      status: "analyzed",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", params.id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json(updated);
}

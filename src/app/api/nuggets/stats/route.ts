import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import type { ContentBlock } from "@/lib/supabase/types";

/**
 * GET /api/nuggets/stats
 * Returns nugget usage statistics: total, freshness, integration rates.
 */
export async function GET() {
  const supabase = getServerClient();

  // Fetch all nuggets
  const { data: nuggets, error } = await supabase
    .from("seo_nuggets")
    .select("id, created_at, site_id, site_ids, tags")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = nuggets?.length ?? 0;
  const currentYear = new Date().getFullYear();

  // Freshness distribution
  let thisYear = 0;
  let lastYear = 0;
  let older = 0;
  for (const n of nuggets || []) {
    const year = new Date(n.created_at).getFullYear();
    if (year === currentYear) thisYear++;
    else if (year === currentYear - 1) lastYear++;
    else older++;
  }

  // Multi-site stats
  const multiSite = (nuggets || []).filter(
    (n) => n.site_ids && n.site_ids.length > 1
  ).length;
  const noSite = (nuggets || []).filter(
    (n) => (!n.site_ids || n.site_ids.length === 0) && !n.site_id
  ).length;

  // Fetch articles with content_blocks to check nugget usage
  const { data: articles } = await supabase
    .from("seo_articles")
    .select("content_blocks, serp_data")
    .not("content_blocks", "is", null);

  const nuggetUsageCount = new Map<string, number>();
  let totalAssignedInArticles = 0;
  let totalIntegratedInArticles = 0;

  for (const article of articles || []) {
    const blocks = (article.content_blocks || []) as ContentBlock[];
    for (const block of blocks) {
      for (const nid of block.nugget_ids || []) {
        nuggetUsageCount.set(nid, (nuggetUsageCount.get(nid) || 0) + 1);
      }
    }
    // Check integration stats from seo_audit if available
    const serpData = article.serp_data as Record<string, unknown> | null;
    const audit = serpData?.seo_audit as Record<string, unknown> | null;
    const integration = audit?.nuggetIntegration as {
      totalAssigned?: number;
      totalIntegrated?: number;
    } | null;
    if (integration) {
      totalAssignedInArticles += integration.totalAssigned || 0;
      totalIntegratedInArticles += integration.totalIntegrated || 0;
    }
  }

  const usedNuggets = nuggetUsageCount.size;
  const unusedNuggets = total - usedNuggets;

  // Top used nuggets
  const topUsed = Array.from(nuggetUsageCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  return NextResponse.json({
    total,
    freshness: { thisYear, lastYear, older },
    multiSite,
    noSite,
    usage: {
      used: usedNuggets,
      unused: unusedNuggets,
      usageRate: total > 0 ? Math.round((usedNuggets / total) * 100) : 0,
    },
    integration: {
      totalAssigned: totalAssignedInArticles,
      totalIntegrated: totalIntegratedInArticles,
      integrationRate:
        totalAssignedInArticles > 0
          ? Math.round(
              (totalIntegratedInArticles / totalAssignedInArticles) * 100
            )
          : 100,
    },
    topUsed,
  });
}

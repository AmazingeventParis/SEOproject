import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { getQueriesForPage } from "@/lib/seo/gsc";
import type { GSCRow } from "@/lib/seo/gsc";

interface RouteContext {
  params: { articleId: string };
}

interface GSCRecommendation {
  type: "opportunity" | "declining" | "low_ctr" | "cannibalization";
  severity: "info" | "warning" | "critical";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Analyze performance data based on GSC metrics and generate actionable recommendations.
 */
function generateRecommendations(
  queries: GSCRow[],
  keyword: string
): GSCRecommendation[] {
  const recommendations: GSCRecommendation[] = [];

  if (queries.length === 0) {
    recommendations.push({
      type: "opportunity",
      severity: "warning",
      message:
        "Aucune donnee GSC disponible pour cette page. Verifiez que la page est indexee et que la GSC property est correctement configuree.",
    });
    return recommendations;
  }

  // Total metrics
  const totalClicks = queries.reduce((sum, q) => sum + q.clicks, 0);
  const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  // Low CTR on high-impression queries
  const lowCtrQueries = queries.filter(
    (q) => q.impressions >= 50 && q.ctr < 0.03 && q.position <= 15
  );
  if (lowCtrQueries.length > 0) {
    recommendations.push({
      type: "low_ctr",
      severity: "warning",
      message: `${lowCtrQueries.length} requete(s) avec beaucoup d'impressions mais un CTR faible (<3%). Ameliorez le titre et la meta description pour ces mots-cles.`,
      data: {
        queries: lowCtrQueries.slice(0, 5).map((q) => ({
          keyword: q.keys[0],
          impressions: q.impressions,
          ctr: (q.ctr * 100).toFixed(1) + "%",
          position: q.position.toFixed(1),
        })),
      },
    });
  }

  // Opportunity: keywords ranking 5-20 with good impressions
  const opportunityQueries = queries.filter(
    (q) => q.position >= 5 && q.position <= 20 && q.impressions >= 20
  );
  if (opportunityQueries.length > 0) {
    recommendations.push({
      type: "opportunity",
      severity: "info",
      message: `${opportunityQueries.length} mot(s)-cle(s) en position 5-20 avec du potentiel. Renforcez le contenu pour ces requetes afin d'atteindre le top 5.`,
      data: {
        queries: opportunityQueries
          .sort(
            (a, b) =>
              b.impressions * (1 - b.ctr) - a.impressions * (1 - a.ctr)
          )
          .slice(0, 5)
          .map((q) => ({
            keyword: q.keys[0],
            impressions: q.impressions,
            position: q.position.toFixed(1),
            clicks: q.clicks,
          })),
      },
    });
  }

  // Check if main keyword is performing well
  const mainKeywordQuery = queries.find(
    (q) =>
      q.keys[0]?.toLowerCase().includes(keyword.toLowerCase()) ||
      keyword.toLowerCase().includes(q.keys[0]?.toLowerCase())
  );
  if (mainKeywordQuery) {
    if (mainKeywordQuery.position > 10) {
      recommendations.push({
        type: "declining",
        severity: "critical",
        message: `Le mot-cle principal "${keyword}" est en position ${mainKeywordQuery.position.toFixed(1)}. L'article n'est pas dans le top 10 — une mise a jour du contenu est recommandee.`,
        data: {
          keyword: mainKeywordQuery.keys[0],
          position: mainKeywordQuery.position.toFixed(1),
          impressions: mainKeywordQuery.impressions,
          clicks: mainKeywordQuery.clicks,
        },
      });
    } else if (mainKeywordQuery.position > 3 && mainKeywordQuery.position <= 10) {
      recommendations.push({
        type: "opportunity",
        severity: "info",
        message: `Le mot-cle principal "${keyword}" est en position ${mainKeywordQuery.position.toFixed(1)}. Proche du top 3 — un renforcement cible pourrait l'y amener.`,
      });
    }
  } else if (totalImpressions > 0) {
    recommendations.push({
      type: "declining",
      severity: "warning",
      message: `Le mot-cle principal "${keyword}" n'apparait pas dans les requetes GSC. L'article recoit des impressions pour d'autres termes — verifiez l'adequation du contenu.`,
    });
  }

  // Overall poor performance
  if (totalImpressions > 100 && avgCtr < 0.02) {
    recommendations.push({
      type: "low_ctr",
      severity: "critical",
      message: `CTR global tres faible (${(avgCtr * 100).toFixed(1)}%) malgre ${totalImpressions} impressions. Le title tag et la meta description doivent etre retravailles.`,
    });
  }

  return recommendations;
}

// GET /api/articles/[articleId]/gsc-analysis — Fetch and analyze GSC data
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  // Fetch article with site
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select(
      "id, keyword, wp_url, status, published_at, serp_data, seo_sites!seo_articles_site_id_fkey(domain, gsc_property)"
    )
    .eq("id", articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  if (article.status !== "published" && article.status !== "refresh_needed") {
    return NextResponse.json(
      { error: "L'article doit etre publie pour analyser les donnees GSC" },
      { status: 422 }
    );
  }

  const site = article.seo_sites as { domain: string; gsc_property: string | null } | null;
  const gscProperty = site?.gsc_property;

  if (!gscProperty) {
    return NextResponse.json(
      { error: "Aucune propriete GSC configuree pour ce site. Ajoutez-la dans les parametres du site." },
      { status: 422 }
    );
  }

  const wpUrl = article.wp_url;
  if (!wpUrl) {
    return NextResponse.json(
      { error: "L'article n'a pas d'URL WordPress" },
      { status: 422 }
    );
  }

  try {
    // Fetch last 90 days of GSC data for this specific page
    const queries = await getQueriesForPage(gscProperty, wpUrl, 90);

    // Compute summary metrics
    const totalClicks = queries.reduce((sum, q) => sum + q.clicks, 0);
    const totalImpressions = queries.reduce((sum, q) => sum + q.impressions, 0);
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const weightedPosition =
      queries.reduce((sum, q) => sum + q.position * q.impressions, 0) /
      (totalImpressions || 1);

    // Generate recommendations
    const recommendations = generateRecommendations(queries, article.keyword);

    const analysisResult = {
      fetchedAt: new Date().toISOString(),
      period: "90 jours",
      summary: {
        totalClicks,
        totalImpressions,
        avgCtr: Math.round(avgCtr * 10000) / 100, // percentage with 2 decimals
        avgPosition: Math.round(weightedPosition * 10) / 10,
      },
      topQueries: queries.slice(0, 20).map((q) => ({
        keyword: q.keys[0],
        clicks: q.clicks,
        impressions: q.impressions,
        ctr: Math.round(q.ctr * 10000) / 100,
        position: Math.round(q.position * 10) / 10,
      })),
      recommendations,
    };

    // Store analysis in serp_data.gsc_analysis
    const existingSerpData = (article.serp_data || {}) as Record<string, unknown>;
    await supabase
      .from("seo_articles")
      .update({
        serp_data: {
          ...existingSerpData,
          gsc_analysis: analysisResult,
          last_gsc_check: analysisResult.fetchedAt,
        },
      })
      .eq("id", articleId);

    return NextResponse.json(analysisResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

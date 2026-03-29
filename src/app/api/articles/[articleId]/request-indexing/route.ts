import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { requestIndexing, getIndexingStatus } from "@/lib/seo/indexing-api";

interface RouteContext {
  params: { articleId: string };
}

/**
 * POST /api/articles/[articleId]/request-indexing
 *
 * Notify Google Indexing API that this article's URL is new or updated.
 * Requires the article to be published (wp_url must exist).
 *
 * Response: { success, url, action, notifyTime?, error? }
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  // Fetch article
  const { data: article, error } = await supabase
    .from("seo_articles")
    .select("id, wp_url, status, keyword, serp_data")
    .eq("id", articleId)
    .single();

  if (error || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  if (!article.wp_url) {
    return NextResponse.json(
      { error: "Article non publie — aucune URL WordPress disponible" },
      { status: 422 }
    );
  }

  // Request indexing
  const result = await requestIndexing(article.wp_url, "URL_UPDATED");

  // Store result in serp_data for tracking
  const existingSerpData = (article.serp_data || {}) as Record<string, unknown>;
  const indexingHistory = (existingSerpData.indexing_requests || []) as Record<string, unknown>[];
  indexingHistory.push({
    requestedAt: new Date().toISOString(),
    url: article.wp_url,
    success: result.success,
    notifyTime: result.notifyTime || null,
    error: result.error || null,
  });

  // Keep only last 10 requests
  if (indexingHistory.length > 10) {
    indexingHistory.splice(0, indexingHistory.length - 10);
  }

  await supabase
    .from("seo_articles")
    .update({
      serp_data: { ...existingSerpData, indexing_requests: indexingHistory },
    })
    .eq("id", articleId);

  return NextResponse.json(result);
}

/**
 * GET /api/articles/[articleId]/request-indexing
 *
 * Check the indexing status of the article's URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  const { data: article, error } = await supabase
    .from("seo_articles")
    .select("id, wp_url, serp_data")
    .eq("id", articleId)
    .single();

  if (error || !article) {
    return NextResponse.json({ error: "Article non trouve" }, { status: 404 });
  }

  if (!article.wp_url) {
    return NextResponse.json(
      { error: "Article non publie — aucune URL WordPress disponible" },
      { status: 422 }
    );
  }

  const status = await getIndexingStatus(article.wp_url);

  // Also return history from serp_data
  const serpData = (article.serp_data || {}) as Record<string, unknown>;
  const history = (serpData.indexing_requests || []) as Record<string, unknown>[];

  return NextResponse.json({
    ...status,
    history,
  });
}

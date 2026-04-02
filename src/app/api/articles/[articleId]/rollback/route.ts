import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { getRollbackStatus, getStatusLabel } from "@/lib/pipeline/state-machine";
import type { ArticleStatus } from "@/lib/supabase/types";

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/rollback - Go back one step in the pipeline
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  // Fetch current article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, status")
    .eq("id", articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  const currentStatus = article.status as ArticleStatus;
  const targetStatus = getRollbackStatus(currentStatus);

  if (!targetStatus) {
    return NextResponse.json(
      { error: `Impossible de revenir en arriere depuis le statut "${getStatusLabel(currentStatus)}"` },
      { status: 422 }
    );
  }

  // Update status
  const { error: updateError } = await supabase
    .from("seo_articles")
    .update({ status: targetStatus })
    .eq("id", articleId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    from: currentStatus,
    to: targetStatus,
    label: getStatusLabel(targetStatus),
  });
}

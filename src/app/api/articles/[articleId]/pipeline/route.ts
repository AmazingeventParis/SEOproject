import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";

interface RouteContext {
  params: { articleId: string };
}

// GET /api/articles/[articleId]/pipeline - Get pipeline run history for an article
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  const { data, error } = await supabase
    .from("seo_pipeline_runs")
    .select("*")
    .eq("article_id", articleId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

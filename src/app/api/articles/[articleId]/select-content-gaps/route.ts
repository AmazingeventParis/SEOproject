import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const selectContentGapsSchema = z.object({
  selected_gaps: z.array(z.string()),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/select-content-gaps
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = selectContentGapsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { selected_gaps } = parsed.data;

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("serp_data")
    .eq("id", params.articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  // Merge selectedContentGaps into existing serp_data
  const serpData = (article.serp_data as Record<string, unknown>) || {};
  const updatedSerpData = {
    ...serpData,
    selectedContentGaps: selected_gaps,
  };

  const { data, error } = await supabase
    .from("seo_articles")
    .update({
      serp_data: updatedSerpData,
    })
    .eq("id", params.articleId)
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

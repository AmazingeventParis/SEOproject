import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { TitleSuggestion } from "@/lib/supabase/types";

const selectTitleSchema = z.object({
  title_index: z.number().int().min(0).max(2),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/select-title
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

  const parsed = selectTitleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { title_index } = parsed.data;

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("title_suggestions")
    .eq("id", params.articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  const suggestions = article.title_suggestions as TitleSuggestion[] | null;
  if (!suggestions || !suggestions[title_index]) {
    return NextResponse.json(
      { error: "Suggestion de titre introuvable" },
      { status: 400 }
    );
  }

  const selected = suggestions[title_index];

  // Mark selected and update title/slug
  const updatedSuggestions = suggestions.map((s, i) => ({
    ...s,
    selected: i === title_index,
  }));

  const { data, error } = await supabase
    .from("seo_articles")
    .update({
      title: selected.title,
      slug: selected.slug,
      title_suggestions: updatedSuggestions,
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

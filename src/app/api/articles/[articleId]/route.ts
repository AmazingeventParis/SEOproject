import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { ArticleUpdate } from "@/lib/supabase/types";

const contentBlockSchema = z.object({
  id: z.string(),
  type: z.enum(["h2", "h3", "paragraph", "list", "faq", "callout", "image"]),
  heading: z.string().optional(),
  content_html: z.string(),
  nugget_ids: z.array(z.string()),
  word_count: z.number(),
  model_used: z.string().optional(),
  status: z.enum(["pending", "written", "approved"]),
});

const updateArticleSchema = z.object({
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  content_blocks: z.array(contentBlockSchema).optional(),
  content_html: z.string().nullable().optional(),
  status: z
    .enum([
      "draft",
      "analyzing",
      "planning",
      "writing",
      "media",
      "seo_check",
      "reviewing",
      "publishing",
      "published",
      "refresh_needed",
    ])
    .optional(),
  persona_id: z.string().uuid().nullable().optional(),
  silo_id: z.string().uuid().nullable().optional(),
  search_intent: z
    .enum(["traffic", "review", "comparison", "discover", "lead_gen", "informational"])
    .optional(),
  word_count: z.number().optional(),
  json_ld: z.record(z.string(), z.unknown()).nullable().optional(),
  serp_data: z.record(z.string(), z.unknown()).nullable().optional(),
  nugget_density_score: z.number().optional(),
});

interface RouteContext {
  params: { articleId: string };
}

// GET /api/articles/[articleId] - Get a single article with full joins
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_articles")
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
    )
    .eq("id", params.articleId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Article non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// PATCH /api/articles/[articleId] - Update an article
export async function PATCH(
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

  const parsed = updateArticleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_articles")
    .update(parsed.data as ArticleUpdate)
    .eq("id", params.articleId)
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
    )
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Article non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// DELETE /api/articles/[articleId] - Delete an article
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { error } = await supabase
    .from("seo_articles")
    .delete()
    .eq("id", params.articleId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

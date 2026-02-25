import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { ArticleStatus } from "@/lib/supabase/types";

const VALID_STATUSES: ArticleStatus[] = [
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
];

const createArticleSchema = z.object({
  site_id: z.string().uuid("site_id doit etre un UUID valide"),
  keyword: z.string().min(1, "Le mot-cle est requis"),
  search_intent: z
    .enum(["traffic", "review", "comparison", "discover", "lead_gen", "informational"])
    .optional()
    .default("traffic"),
  persona_id: z.string().uuid("persona_id doit etre un UUID valide").nullable().optional(),
  silo_id: z.string().uuid("silo_id doit etre un UUID valide").nullable().optional(),
  link_to_money_page: z.boolean().optional().default(false),
});

// GET /api/articles - List articles with filters and joins
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);

  const siteId = searchParams.get("site_id");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = supabase
    .from("seo_articles")
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain), seo_personas!seo_articles_persona_id_fkey(name, role)"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (siteId) {
    query = query.eq("site_id", siteId);
  }

  if (status && VALID_STATUSES.includes(status as ArticleStatus)) {
    query = query.eq("status", status as ArticleStatus);
  }

  if (search) {
    query = query.or(
      `keyword.ilike.%${search}%,title.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// POST /api/articles - Create a new article
export async function POST(request: NextRequest) {
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

  const parsed = createArticleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const insertData = {
    site_id: parsed.data.site_id,
    keyword: parsed.data.keyword,
    search_intent: parsed.data.search_intent,
    persona_id: parsed.data.persona_id ?? null,
    silo_id: parsed.data.silo_id ?? null,
    link_to_money_page: parsed.data.link_to_money_page,
    status: "draft" as ArticleStatus,
  };

  const { data, error } = await supabase
    .from("seo_articles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(insertData as any)
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain), seo_personas!seo_articles_persona_id_fkey(name, role)"
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

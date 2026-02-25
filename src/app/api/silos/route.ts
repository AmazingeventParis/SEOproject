import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { SiloInsert } from "@/lib/supabase/types";

const createSiloSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  site_id: z.string().uuid("site_id doit etre un UUID valide"),
  description: z.string().nullable().optional(),
  pillar_article_id: z
    .string()
    .uuid("pillar_article_id doit etre un UUID valide")
    .nullable()
    .optional(),
});

// GET /api/silos - List silos with optional site_id filter
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);

  const siteId = searchParams.get("site_id");

  let query = supabase
    .from("seo_silos")
    .select("*, seo_sites!seo_silos_site_id_fkey(name)")
    .order("created_at", { ascending: false });

  if (siteId) {
    query = query.eq("site_id", siteId);
  }

  const { data: silos, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Count articles per silo
  const siloIds = (silos ?? []).map((s) => s.id);

  let articleCounts: Record<string, number> = {};

  if (siloIds.length > 0) {
    const { data: articles, error: countError } = await supabase
      .from("seo_articles")
      .select("silo_id")
      .in("silo_id", siloIds);

    if (!countError && articles) {
      articleCounts = articles.reduce<Record<string, number>>((acc, article) => {
        const sid = article.silo_id;
        if (sid) {
          acc[sid] = (acc[sid] ?? 0) + 1;
        }
        return acc;
      }, {});
    }
  }

  const result = (silos ?? []).map((silo) => ({
    ...silo,
    article_count: articleCounts[silo.id] ?? 0,
  }));

  return NextResponse.json(result);
}

// POST /api/silos - Create a new silo
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

  const parsed = createSiloSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_silos")
    .insert(parsed.data as SiloInsert)
    .select("*, seo_sites!seo_silos_site_id_fkey(name)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

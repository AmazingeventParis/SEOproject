import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { SiloUpdate } from "@/lib/supabase/types";

const updateSiloSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  pillar_article_id: z
    .string()
    .uuid("pillar_article_id doit etre un UUID valide")
    .nullable()
    .optional(),
});

interface RouteContext {
  params: { siloId: string };
}

// GET /api/silos/[siloId] - Get a single silo with site info and articles
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data: silo, error } = await supabase
    .from("seo_silos")
    .select("*, seo_sites!seo_silos_site_id_fkey(name)")
    .eq("id", params.siloId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Silo non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch articles belonging to this silo
  const { data: articles, error: articlesError } = await supabase
    .from("seo_articles")
    .select("id, keyword, title, status, slug")
    .eq("silo_id", params.siloId)
    .order("created_at", { ascending: false });

  if (articlesError) {
    return NextResponse.json(
      { error: articlesError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ...silo,
    articles: articles ?? [],
  });
}

// PATCH /api/silos/[siloId] - Update a silo
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

  const parsed = updateSiloSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_silos")
    .update(parsed.data as SiloUpdate)
    .eq("id", params.siloId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Silo non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/silos/[siloId] - Delete a silo
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { error } = await supabase
    .from("seo_silos")
    .delete()
    .eq("id", params.siloId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

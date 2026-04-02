import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type SiloLinkInsert = Database["public"]["Tables"]["seo_silo_links"]["Insert"];

const createLinkSchema = z.object({
  source_article_id: z
    .string()
    .uuid("source_article_id doit etre un UUID valide"),
  target_article_id: z
    .string()
    .uuid("target_article_id doit etre un UUID valide"),
  anchor_text: z.string().min(1, "Le texte d'ancre est requis"),
  is_bidirectional: z.boolean().optional(),
});

const deleteLinkSchema = z.object({
  link_id: z.string().uuid("link_id doit etre un UUID valide"),
});

interface RouteContext {
  params: { siloId: string };
}

// GET /api/silos/[siloId]/links - List all links for a silo
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_silo_links")
    .select(
      "*, source:seo_articles!seo_silo_links_source_article_id_fkey(id, keyword, title), target:seo_articles!seo_silo_links_target_article_id_fkey(id, keyword, title)"
    )
    .eq("silo_id", params.siloId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// POST /api/silos/[siloId]/links - Create a new silo link
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

  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const insertData: SiloLinkInsert = {
    silo_id: params.siloId,
    source_article_id: parsed.data.source_article_id,
    target_article_id: parsed.data.target_article_id,
    anchor_text: parsed.data.anchor_text,
    is_bidirectional: parsed.data.is_bidirectional ?? false,
  };

  const { data, error } = await supabase
    .from("seo_silo_links")
    .insert(insertData)
    .select(
      "*, source:seo_articles!seo_silo_links_source_article_id_fkey(id, keyword, title), target:seo_articles!seo_silo_links_target_article_id_fkey(id, keyword, title)"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// DELETE /api/silos/[siloId]/links - Delete a silo link by link_id in body
export async function DELETE(
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

  const parsed = deleteLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { error } = await supabase
    .from("seo_silo_links")
    .delete()
    .eq("id", parsed.data.link_id)
    .eq("silo_id", params.siloId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

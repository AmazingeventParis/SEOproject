import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { DiscoverItemInsert } from "@/lib/supabase/types";

const sourceEnum = z.enum(["twitter", "trends", "serp", "manual"]);
const statusEnum = z.enum(["new", "selected", "converted", "dismissed"]);

const createDiscoverItemSchema = z.object({
  topic: z.string().min(1, "Le sujet est requis"),
  site_id: z.string().uuid("L'identifiant du site doit etre un UUID valide"),
  source: sourceEnum,
  raw_data: z.record(z.string(), z.unknown()).optional(),
});

// GET /api/discover - List discover items with optional filters
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const { searchParams } = request.nextUrl;

  const siteId = searchParams.get("site_id");
  const status = searchParams.get("status");
  const source = searchParams.get("source");

  let query = supabase
    .from("seo_discover_items")
    .select("*, seo_sites!seo_discover_items_site_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (siteId) {
    query = query.eq("site_id", siteId);
  }

  if (status) {
    const parsed = statusEnum.safeParse(status);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Statut invalide. Valeurs acceptees : new, selected, converted, dismissed" },
        { status: 400 }
      );
    }
    query = query.eq("status", parsed.data);
  }

  if (source) {
    const parsed = sourceEnum.safeParse(source);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Source invalide. Valeurs acceptees : twitter, trends, serp, manual" },
        { status: 400 }
      );
    }
    query = query.eq("source", parsed.data);
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

// POST /api/discover - Create a new discover item
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

  const parsed = createDiscoverItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const insertData: DiscoverItemInsert = {
    ...parsed.data,
    status: "new",
  };

  const { data, error } = await supabase
    .from("seo_discover_items")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

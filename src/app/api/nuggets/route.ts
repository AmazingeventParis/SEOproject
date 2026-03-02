import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createNuggetSchema = z.object({
  content: z.string().min(1, "Le contenu est requis"),
  source_type: z.enum(["vocal", "tweet", "note", "url", "observation", "youtube"], {
    message: "Le type de source est requis",
  }),
  source_ref: z.string().nullable().optional(),
  site_id: z.string().uuid("site_id doit etre un UUID valide").nullable().optional(),
  persona_id: z.string().uuid("persona_id doit etre un UUID valide").nullable().optional(),
  tags: z.array(z.string()).optional(),
});

// GET /api/nuggets - List nuggets with filters
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);

  const siteId = searchParams.get("site_id");
  const tags = searchParams.get("tags");
  const search = searchParams.get("search");
  const sourceType = searchParams.get("source_type");

  let query = supabase
    .from("seo_nuggets")
    .select("*, seo_sites!seo_nuggets_site_id_fkey(name, domain)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (siteId) {
    query = query.eq("site_id", siteId);
  }

  if (tags) {
    const tagArray = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagArray.length > 0) {
      query = query.contains("tags", tagArray);
    }
  }

  if (search) {
    query = query.ilike("content", `%${search}%`);
  }

  if (sourceType) {
    query = query.eq("source_type", sourceType as "vocal" | "tweet" | "note" | "url" | "observation" | "youtube");
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

// POST /api/nuggets - Create a new nugget
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

  const parsed = createNuggetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_nuggets")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(parsed.data as any)
    .select("*, seo_sites!seo_nuggets_site_id_fkey(name, domain)")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

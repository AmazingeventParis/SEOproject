import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createPersonaSchema = z.object({
  site_ids: z.array(z.string().uuid()).min(1, "Au moins un site est requis"),
  name: z.string().min(1, "Le nom est requis"),
  role: z.string().min(1, "Le role est requis"),
  tone_description: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_reference_url: z.string().url("L'URL doit etre valide").nullable().optional(),
  writing_style_examples: z.array(z.record(z.string(), z.unknown())).optional(),
  banned_phrases: z.array(z.string()).optional(),
  familiar_expressions: z.array(z.string()).optional(),
});

// GET /api/personas - List all personas with their associated sites
export async function GET(request: NextRequest) {
  const supabase = getServerClient();

  // Optional filter by site_id
  const { searchParams } = new URL(request.url);
  const filterSiteId = searchParams.get("site_id");

  if (filterSiteId) {
    // Filter personas that belong to this site via pivot table
    const { data, error } = await supabase
      .from("seo_persona_sites")
      .select("persona_id, seo_personas(*, seo_persona_sites(site_id, seo_sites(id, name, domain)))")
      .eq("site_id", filterSiteId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Unwrap nested structure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const personas = (data as any[])
      .map((row) => row.seo_personas)
      .filter(Boolean);
    return NextResponse.json(personas);
  }

  // All personas
  const { data, error } = await supabase
    .from("seo_personas")
    .select("*, seo_persona_sites(site_id, seo_sites(id, name, domain))")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/personas - Create a new persona with site associations
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

  const parsed = createPersonaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { site_ids, ...personaData } = parsed.data;

  // Create the persona (site_id = first site for backward compat)
  const { data: persona, error } = await supabase
    .from("seo_personas")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert({ ...personaData, site_id: site_ids[0] } as any)
    .select("*")
    .single();

  if (error || !persona) {
    return NextResponse.json(
      { error: error?.message || "Erreur creation persona" },
      { status: 500 }
    );
  }

  // Create pivot entries
  const pivotEntries = site_ids.map((sid) => ({
    persona_id: persona.id,
    site_id: sid,
  }));

  await supabase.from("seo_persona_sites").insert(pivotEntries);

  // Re-fetch with sites
  const { data: full } = await supabase
    .from("seo_personas")
    .select("*, seo_persona_sites(site_id, seo_sites(id, name, domain))")
    .eq("id", persona.id)
    .single();

  return NextResponse.json(full, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createPersonaSchema = z.object({
  site_id: z.string().uuid("site_id doit etre un UUID valide"),
  name: z.string().min(1, "Le nom est requis"),
  role: z.string().min(1, "Le role est requis"),
  tone_description: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_reference_url: z.string().url("L'URL doit etre valide").nullable().optional(),
  writing_style_examples: z.array(z.record(z.string(), z.unknown())).optional(),
});

// GET /api/personas - List all personas with site info
export async function GET() {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_personas")
    .select("*, seo_sites!seo_personas_site_id_fkey(name, domain)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// POST /api/personas - Create a new persona
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

  const { data, error } = await supabase
    .from("seo_personas")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(parsed.data as any)
    .select("*, seo_sites!seo_personas_site_id_fkey(name, domain)")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

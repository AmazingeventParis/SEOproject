import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const updatePersonaSchema = z.object({
  site_id: z.string().uuid("site_id doit etre un UUID valide").optional(),
  name: z.string().min(1, "Le nom est requis").optional(),
  role: z.string().min(1, "Le role est requis").optional(),
  tone_description: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  avatar_reference_url: z.string().url("L'URL doit etre valide").nullable().optional(),
  writing_style_examples: z.array(z.record(z.string(), z.unknown())).optional(),
});

interface RouteParams {
  params: { personaId: string };
}

// GET /api/personas/[personaId] - Get a single persona
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const supabase = getServerClient();
  const { personaId } = params;

  const { data, error } = await supabase
    .from("seo_personas")
    .select("*, seo_sites!seo_personas_site_id_fkey(name, domain)")
    .eq("id", personaId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Persona non trouve" },
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

// PATCH /api/personas/[personaId] - Update a persona
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const supabase = getServerClient();
  const { personaId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = updatePersonaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_personas")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ ...parsed.data, updated_at: new Date().toISOString() } as any)
    .eq("id", personaId)
    .select("*, seo_sites!seo_personas_site_id_fkey(name, domain)")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Persona non trouve" },
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

// DELETE /api/personas/[personaId] - Delete a persona
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
) {
  const supabase = getServerClient();
  const { personaId } = params;

  const { error } = await supabase
    .from("seo_personas")
    .delete()
    .eq("id", personaId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

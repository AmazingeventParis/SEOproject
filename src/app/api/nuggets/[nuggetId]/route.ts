import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { NuggetUpdate } from "@/lib/supabase/types";

const updateNuggetSchema = z.object({
  content: z.string().min(1).optional(),
  source_type: z.enum(["vocal", "tweet", "note", "url", "observation"]).optional(),
  source_ref: z.string().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  persona_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

interface RouteContext {
  params: { nuggetId: string };
}

// GET /api/nuggets/[nuggetId] - Get a single nugget
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_nuggets")
    .select("*, seo_sites!seo_nuggets_site_id_fkey(name, domain)")
    .eq("id", params.nuggetId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Nugget non trouve" },
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

// PATCH /api/nuggets/[nuggetId] - Update a nugget
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

  const parsed = updateNuggetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_nuggets")
    .update(parsed.data as NuggetUpdate)
    .eq("id", params.nuggetId)
    .select("*, seo_sites!seo_nuggets_site_id_fkey(name, domain)")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Nugget non trouve" },
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

// DELETE /api/nuggets/[nuggetId] - Delete a nugget
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { error } = await supabase
    .from("seo_nuggets")
    .delete()
    .eq("id", params.nuggetId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

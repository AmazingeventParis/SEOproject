import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { DiscoverItemUpdate } from "@/lib/supabase/types";

const updateDiscoverItemSchema = z.object({
  status: z.enum(["new", "selected", "converted", "dismissed"]).optional(),
  topic: z.string().min(1, "Le sujet ne peut pas etre vide").optional(),
  article_id: z.string().uuid("L'identifiant de l'article doit etre un UUID valide").optional(),
});

interface RouteContext {
  params: { itemId: string };
}

// GET /api/discover/[itemId] - Get a single discover item
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_discover_items")
    .select("*, seo_sites!seo_discover_items_site_id_fkey(name)")
    .eq("id", params.itemId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Element Discover non trouve" },
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

// PATCH /api/discover/[itemId] - Update a discover item
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

  const parsed = updateDiscoverItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_discover_items")
    .update(parsed.data as DiscoverItemUpdate)
    .eq("id", params.itemId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Element Discover non trouve" },
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

// DELETE /api/discover/[itemId] - Delete a discover item
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { error } = await supabase
    .from("seo_discover_items")
    .delete()
    .eq("id", params.itemId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

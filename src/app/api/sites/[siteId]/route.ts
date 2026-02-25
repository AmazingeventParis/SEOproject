import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { SiteUpdate } from "@/lib/supabase/types";

const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  wp_url: z.string().url().optional(),
  wp_user: z.string().min(1).optional(),
  wp_app_password: z.string().min(1).optional(),
  gsc_property: z.string().nullable().optional(),
  niche: z.string().nullable().optional(),
  money_page_url: z.string().nullable().optional(),
  money_page_description: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

interface RouteContext {
  params: { siteId: string };
}

// GET /api/sites/[siteId] - Get a single site
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_sites")
    .select("*")
    .eq("id", params.siteId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Site non trouve" },
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

// PATCH /api/sites/[siteId] - Update a site
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

  const parsed = updateSiteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_sites")
    .update({ ...parsed.data, updated_at: new Date().toISOString() } as SiteUpdate)
    .eq("id", params.siteId)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Site non trouve" },
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

// DELETE /api/sites/[siteId] - Delete a site
export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  const { error } = await supabase
    .from("seo_sites")
    .delete()
    .eq("id", params.siteId);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return new NextResponse(null, { status: 204 });
}

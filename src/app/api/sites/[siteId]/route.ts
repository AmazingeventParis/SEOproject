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
  theme_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
    .or(z.literal("")),
  blog_path: z.string().nullable().optional(),
  money_page_url: z.string().nullable().optional(),
  money_page_description: z.string().nullable().optional(),
  active: z.boolean().optional(),
  editorial_angle: z.record(z.string(), z.unknown()).nullable().optional(),
  // GDS — GestionnaireDeSite (optionnel, parallèle WordPress)
  gds_url: z.string().nullable().optional(),
  gds_api_token: z.string().nullable().optional(),
  gds_author: z.enum(['mathilde', 'elise']).nullable().optional(),
  gds_category_map: z.record(z.string(), z.string()).nullable().optional(),
  publication_target: z.enum(['wordpress', 'gds']).nullable().optional(),
}).passthrough();

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

  // Strip editorial_angle if the column doesn't exist yet (migration pending)
  const updatePayload = { ...parsed.data, updated_at: new Date().toISOString() };

  const { data, error } = await supabase
    .from("seo_sites")
    .update(updatePayload as SiteUpdate)
    .eq("id", params.siteId)
    .select()
    .single();

  if (error) {
    // If editorial_angle column doesn't exist, retry without it
    if (error.message?.includes('editorial_angle')) {
      const { editorial_angle: _ea, ...payloadWithout } = updatePayload;
      const { data: d2, error: e2 } = await supabase
        .from("seo_sites")
        .update(payloadWithout as SiteUpdate)
        .eq("id", params.siteId)
        .select()
        .single();
      if (e2) {
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      return NextResponse.json(d2);
    }
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

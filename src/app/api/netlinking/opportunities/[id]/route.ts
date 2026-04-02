import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const updateSchema = z.object({
  vendor_domain: z.string().optional(),
  vendor_url: z.string().nullable().optional(),
  tf: z.number().min(0).max(100).optional(),
  cf: z.number().min(0).max(100).optional(),
  da: z.number().min(0).max(100).optional(),
  dr: z.number().min(0).max(100).optional(),
  organic_traffic: z.number().min(0).optional(),
  price: z.number().min(0).optional(),
  target_page: z.string().nullable().optional(),
  target_keyword: z.string().nullable().optional(),
  niche: z.string().nullable().optional(),
  status: z.enum(["new", "analyzed", "approved", "article_generated", "purchased", "published", "rejected"]).optional(),
  notes: z.string().nullable().optional(),
  published_url: z.string().nullable().optional(),
}).passthrough();

interface RouteContext {
  params: { id: string };
}

// GET /api/netlinking/opportunities/[id]
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .select("*")
    .eq("id", params.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "Non trouve" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// PATCH /api/netlinking/opportunities/[id]
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("seo_link_opportunities" as any).update(parsed.data as any).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/netlinking/opportunities/[id]
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from("seo_link_opportunities" as any).delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

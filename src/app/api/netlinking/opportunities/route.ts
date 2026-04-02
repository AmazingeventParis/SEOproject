import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createOpportunitySchema = z.object({
  site_id: z.string().uuid(),
  vendor_domain: z.string().min(1),
  vendor_url: z.string().nullable().optional(),
  tf: z.number().min(0).max(100).default(0),
  cf: z.number().min(0).max(100).default(0),
  da: z.number().min(0).max(100).default(0),
  dr: z.number().min(0).max(100).default(0),
  organic_traffic: z.number().min(0).default(0),
  price: z.number().min(0).default(0),
  target_page: z.string().nullable().optional(),
  target_keyword: z.string().nullable().optional(),
  niche: z.string().nullable().optional(),
  language: z.string().default("fr"),
  notes: z.string().nullable().optional(),
});

// GET /api/netlinking/opportunities?site_id=...&status=...
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("site_id");
  const status = searchParams.get("status");

  let query = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .select("*")
    .order("overall_score", { ascending: false })
    .limit(100);

  if (siteId) query = query.eq("site_id", siteId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/netlinking/opportunities
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = createOpportunitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("seo_link_opportunities" as any).insert(parsed.data as any).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

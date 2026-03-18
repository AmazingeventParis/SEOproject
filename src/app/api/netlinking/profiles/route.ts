import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createProfileSchema = z.object({
  site_id: z.string().uuid(),
  tf: z.coerce.number().min(0).default(0),
  cf: z.coerce.number().min(0).default(0),
  da: z.coerce.number().min(0).default(0),
  dr: z.coerce.number().min(0).default(0),
  referring_domains: z.coerce.number().min(0).default(0),
  total_backlinks: z.coerce.number().min(0).default(0),
  organic_traffic: z.coerce.number().min(0).default(0),
  organic_keywords: z.coerce.number().min(0).default(0),
  notes: z.string().nullable().optional(),
});

// GET /api/netlinking/profiles?site_id=...
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const siteId = new URL(request.url).searchParams.get("site_id");

  let query = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_profiles" as any)
    .select("*, seo_sites!seo_link_profiles_site_id_fkey(name, domain, niche)")
    .order("snapshot_date", { ascending: false })
    .limit(50);

  if (siteId) query = query.eq("site_id", siteId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/netlinking/profiles — upsert: update today's snapshot if exists, else create
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = createProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  // Check if a snapshot already exists for this site (any date) — update it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_profiles" as any)
    .select("id")
    .eq("site_id", parsed.data.site_id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    // Update existing snapshot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_link_profiles" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ ...parsed.data, snapshot_date: new Date().toISOString().split("T")[0] } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq("id", (existing as any).id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Create new snapshot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("seo_link_profiles" as any).insert(parsed.data as any).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const createPurchaseSchema = z.object({
  opportunity_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid(),
  vendor_domain: z.string().min(1),
  price_paid: z.number().min(0),
  currency: z.string().default("EUR"),
  target_page: z.string().nullable().optional(),
  anchor_text: z.string().nullable().optional(),
  anchor_type: z.enum(["exact", "broad", "brand", "naked_url", "generic"]).nullable().optional(),
  published_url: z.string().nullable().optional(),
  do_follow: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

// GET /api/netlinking/purchases?site_id=...
export async function GET(request: NextRequest) {
  const supabase = getServerClient();
  const siteId = new URL(request.url).searchParams.get("site_id");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_purchases" as any)
    .select("*")
    .order("ordered_at", { ascending: false })
    .limit(100);

  if (siteId) query = query.eq("site_id", siteId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/netlinking/purchases
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = createPurchaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from("seo_link_purchases" as any).insert(parsed.data as any).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If linked to opportunity, update its status
  if (parsed.data.opportunity_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_link_opportunities" as any)
      .update({ status: "purchased", purchased_at: new Date().toISOString() })
      .eq("id", parsed.data.opportunity_id);
  }

  return NextResponse.json(data, { status: 201 });
}

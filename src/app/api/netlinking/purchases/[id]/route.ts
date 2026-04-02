import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const updateSchema = z.object({
  status: z.enum(["ordered", "writing", "published", "verified", "lost"]).optional(),
  anchor_text: z.string().nullable().optional(),
  anchor_type: z.enum(["exact", "broad", "brand", "naked_url", "generic"]).nullable().optional(),
  published_url: z.string().nullable().optional(),
  do_follow: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

interface RouteContext {
  params: { id: string };
}

// PATCH /api/netlinking/purchases/[id]
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

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "published") updateData.published_at = new Date().toISOString();
  if (parsed.data.status === "verified") updateData.verified_at = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_purchases" as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(updateData as any)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

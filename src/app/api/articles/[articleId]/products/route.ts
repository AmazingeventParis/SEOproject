import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

const specSchema = z.object({
  criterion_id: z.string().uuid(),
  value: z.string(),
  rating: z.enum(["above", "average", "below"]),
});

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  price_label: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  affiliate_url: z.string().nullable().optional(),
  affiliate_enabled: z.boolean().default(false),
  rating: z.coerce.number().nullable().optional(),
  rating_scale: z.coerce.number().default(10),
  verdict: z.string().nullable().optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  specs: z.array(specSchema).default([]),
  sort_order: z.coerce.number().default(0),
});

const criterionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  unit: z.string().nullable().optional(),
  sort_order: z.coerce.number().default(0),
});

const saveSchema = z.object({
  products: z.array(productSchema),
  criteria: z.array(criterionSchema),
});

// GET /api/articles/[articleId]/products
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const { articleId } = await params;
  const supabase = getServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: products, error: pErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_products" as any)
    .select("*")
    .eq("article_id", articleId)
    .order("sort_order", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: criteria, error: cErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_comparison_criteria" as any)
    .select("*")
    .eq("article_id", articleId)
    .order("sort_order", { ascending: true });

  if (pErr || cErr) {
    return NextResponse.json(
      { error: (pErr || cErr)?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ products: products || [], criteria: criteria || [] });
}

// POST /api/articles/[articleId]/products — Save all products + criteria (replace)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const { articleId } = await params;
  const supabase = getServerClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { products, criteria } = parsed.data;

  // Delete existing criteria + products for this article, then re-insert
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from("seo_products" as any).delete().eq("article_id", articleId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from("seo_comparison_criteria" as any).delete().eq("article_id", articleId);

  // Insert criteria
  const criteriaToInsert = criteria.map((c, i) => ({
    id: c.id || undefined,
    article_id: articleId,
    name: c.name,
    unit: c.unit || null,
    sort_order: i,
  }));

  let insertedCriteria: { id: string; name: string }[] = [];
  if (criteriaToInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_comparison_criteria" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(criteriaToInsert as any)
      .select("id, name");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insertedCriteria = (data || []) as any[];
  }

  // Build criterion ID mapping (old temp ID → new real ID)
  const criteriaIdMap = new Map<string, string>();
  criteriaToInsert.forEach((c, i) => {
    if (c.id && insertedCriteria[i]) {
      criteriaIdMap.set(c.id, insertedCriteria[i].id);
    }
  });

  // Insert products with remapped criterion IDs in specs
  const productsToInsert = products.map((p, i) => ({
    article_id: articleId,
    name: p.name,
    brand: p.brand || null,
    price: p.price ?? null,
    price_label: p.price_label || null,
    image_url: p.image_url || null,
    affiliate_url: p.affiliate_url || null,
    affiliate_enabled: p.affiliate_enabled,
    rating: p.rating ?? null,
    rating_scale: p.rating_scale,
    verdict: p.verdict || null,
    pros: p.pros,
    cons: p.cons,
    specs: p.specs.map((s) => ({
      ...s,
      criterion_id: criteriaIdMap.get(s.criterion_id) || s.criterion_id,
    })),
    sort_order: i,
  }));

  if (productsToInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_products" as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(productsToInsert as any);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Snapshot product data into serp_data.productComparison for prompt injection
  const snapshot = {
    products: productsToInsert,
    criteria: criteriaToInsert.map((c, i) => ({
      id: insertedCriteria[i]?.id || c.id,
      name: c.name,
      unit: c.unit,
    })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: article } = await supabase
    .from("seo_articles")
    .select("serp_data")
    .eq("id", articleId)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serpData = (article?.serp_data || {}) as any;
  serpData.productComparison = snapshot;

  await supabase
    .from("seo_articles")
    .update({ serp_data: serpData })
    .eq("id", articleId);

  return NextResponse.json({ success: true, products_count: productsToInsert.length, criteria_count: criteriaToInsert.length });
}

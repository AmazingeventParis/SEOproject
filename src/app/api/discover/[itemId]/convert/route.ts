import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { ArticleInsert } from "@/lib/supabase/types";

const convertSchema = z.object({
  persona_id: z.string().uuid("L'identifiant du persona doit etre un UUID valide").optional(),
  silo_id: z.string().uuid("L'identifiant du silo doit etre un UUID valide").optional(),
});

interface RouteContext {
  params: { itemId: string };
}

// POST /api/discover/[itemId]/convert - Convert a discover item into an article draft
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  // 1. Fetch the discover item
  const { data: item, error: fetchError } = await supabase
    .from("seo_discover_items")
    .select("*")
    .eq("id", params.itemId)
    .single();

  if (fetchError) {
    if (fetchError.code === "PGRST116") {
      return NextResponse.json(
        { error: "Element Discover non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: fetchError.message },
      { status: 500 }
    );
  }

  // 2. Validate status - must not already be converted
  if (item.status !== "new" && item.status !== "selected") {
    return NextResponse.json(
      { error: "Cet element ne peut pas etre converti. Statut actuel : " + item.status },
      { status: 409 }
    );
  }

  // 3. Parse optional body
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is acceptable
  }

  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  // 4. Create a new article draft
  const articleInsert: ArticleInsert = {
    keyword: item.topic,
    site_id: item.site_id,
    search_intent: "traffic",
    status: "draft",
    persona_id: parsed.data.persona_id ?? null,
    silo_id: parsed.data.silo_id ?? null,
  };

  const { data: newArticle, error: articleError } = await supabase
    .from("seo_articles")
    .insert(articleInsert)
    .select("id")
    .single();

  if (articleError) {
    return NextResponse.json(
      { error: "Erreur lors de la creation de l'article : " + articleError.message },
      { status: 500 }
    );
  }

  // 5. Update the discover item to 'converted'
  const { error: updateError } = await supabase
    .from("seo_discover_items")
    .update({ status: "converted" as const, article_id: newArticle.id })
    .eq("id", params.itemId);

  if (updateError) {
    return NextResponse.json(
      { error: "Article cree mais erreur lors de la mise a jour de l'element Discover : " + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    article_id: newArticle.id,
    discover_item_id: params.itemId,
    message: "Item converti en article avec succes",
  }, { status: 201 });
}

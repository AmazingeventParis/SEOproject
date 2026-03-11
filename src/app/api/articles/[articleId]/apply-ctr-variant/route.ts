import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";

interface RouteContext {
  params: { articleId: string };
}

const applySchema = z.object({
  seo_title: z.string().min(1),
  meta_description: z.string().min(1),
  pushToWp: z.boolean().optional(),
});

// POST /api/articles/[articleId]/apply-ctr-variant
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  // Update article with selected variant
  const { error } = await supabase
    .from("seo_articles")
    .update({
      seo_title: parsed.data.seo_title,
      meta_description: parsed.data.meta_description,
    })
    .eq("id", articleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Optionally push to WordPress
  if (parsed.data.pushToWp) {
    try {
      const { data: article } = await supabase
        .from("seo_articles")
        .select("wp_post_id, site_id")
        .eq("id", articleId)
        .single();

      if (article?.wp_post_id) {
        const { updatePost } = await import("@/lib/wordpress/client");
        await updatePost(article.site_id, article.wp_post_id, {
          meta: {
            _yoast_wpseo_title: parsed.data.seo_title,
            _yoast_wpseo_metadesc: parsed.data.meta_description,
            rank_math_title: parsed.data.seo_title,
            rank_math_description: parsed.data.meta_description,
          },
        });
      }
    } catch (err) {
      console.warn("[apply-ctr-variant] WP update failed:", err);
      // Don't fail the request - DB update was successful
    }
  }

  return NextResponse.json({ success: true });
}

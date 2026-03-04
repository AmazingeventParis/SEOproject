import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { getPostById } from "@/lib/wordpress/client";
import { parseHtmlToBlocks, extractMainKeyword } from "@/lib/pipeline/html-parser";

interface RouteContext {
  params: { siteId: string };
}

const importSchema = z.object({
  wp_post_id: z.number().int().positive(),
  persona_id: z.string().uuid().nullable().optional(),
  silo_id: z.string().uuid().nullable().optional(),
});

const batchImportSchema = z.object({
  posts: z.array(importSchema).min(1).max(50),
});

// POST /api/sites/[siteId]/wp-import — Import WP post(s) into seo_articles
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const { siteId } = params;
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

  // Support both single post and batch import
  const parsed = batchImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const results: { wp_post_id: number; article_id?: string; error?: string }[] = [];

  for (const post of parsed.data.posts) {
    try {
      // Check if already imported
      const { data: existing } = await supabase
        .from("seo_articles")
        .select("id")
        .eq("site_id", siteId)
        .eq("wp_post_id", post.wp_post_id)
        .maybeSingle();

      if (existing) {
        results.push({ wp_post_id: post.wp_post_id, error: "Deja importe" });
        continue;
      }

      // Fetch full post content from WordPress
      const wpPost = await getPostById(siteId, post.wp_post_id);

      // Parse HTML into content blocks
      const contentBlocks = parseHtmlToBlocks(wpPost.content);
      const totalWords = contentBlocks.reduce((sum, b) => sum + b.word_count, 0);

      // Extract keyword from title
      const keyword = extractMainKeyword(wpPost.title);

      // Create slug from WP link
      const slug = wpPost.link
        ? new URL(wpPost.link).pathname.replace(/^\/|\/$/g, "").split("/").pop() || ""
        : "";

      // Insert into seo_articles
      const { data: article, error } = await supabase
        .from("seo_articles")
        .insert({
          site_id: siteId,
          keyword,
          title: wpPost.title,
          slug: slug || undefined,
          status: "published",
          wp_post_id: wpPost.id,
          wp_url: wpPost.link,
          content_blocks: contentBlocks,
          content_html: wpPost.content,
          word_count: totalWords,
          published_at: new Date().toISOString(),
          persona_id: post.persona_id || null,
          silo_id: post.silo_id || null,
          search_intent: "traffic",
          year_tag: new Date().getFullYear(),
        })
        .select("id")
        .single();

      if (error) {
        results.push({ wp_post_id: post.wp_post_id, error: error.message });
      } else {
        results.push({ wp_post_id: post.wp_post_id, article_id: article.id });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      results.push({ wp_post_id: post.wp_post_id, error: message });
    }
  }

  const imported = results.filter((r) => r.article_id).length;
  const errors = results.filter((r) => r.error).length;

  return NextResponse.json({
    imported,
    errors,
    results,
  });
}

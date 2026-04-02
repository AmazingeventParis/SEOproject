import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { updatePost } from "@/lib/wordpress/client";
import type { ContentBlock } from "@/lib/supabase/types";

interface RouteContext {
  params: { siteId: string };
}

const yearUpdateSchema = z.object({
  pushToWp: z.boolean().optional().default(false),
});

// POST /api/sites/[siteId]/year-update — Batch update years in all published articles
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
    body = {};
  }

  const parsed = yearUpdateSchema.safeParse(body);
  const pushToWp = parsed.success ? parsed.data.pushToWp : false;

  const currentYear = new Date().getFullYear();
  const yearRegex = /\b(202[0-9])\b/g;

  // Fetch all published articles for this site
  const { data: articles, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, content_blocks, content_html, year_tag, json_ld, wp_post_id, title, slug")
    .eq("site_id", siteId)
    .eq("status", "published");

  if (fetchError) {
    return NextResponse.json(
      { error: fetchError.message },
      { status: 500 }
    );
  }

  if (!articles || articles.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, errors: [] });
  }

  let updated = 0;
  let skipped = 0;
  const errors: { articleId: string; error: string }[] = [];

  for (const article of articles) {
    try {
      const blocks = (article.content_blocks || []) as ContentBlock[];
      let hasStaleYears = false;

      // Check if any block has stale years
      for (const block of blocks) {
        if (!block.content_html) continue;
        const matches = block.content_html.match(yearRegex);
        if (matches && !matches.includes(String(currentYear))) {
          hasStaleYears = true;
          break;
        }
      }

      // Also check if year_tag is outdated
      if (!hasStaleYears && article.year_tag === currentYear) {
        skipped++;
        continue;
      }

      // Update years in content blocks
      const updatedBlocks = blocks.map((block) => {
        if (!block.content_html) return block;
        const updatedHtml = block.content_html.replace(yearRegex, String(currentYear));
        if (updatedHtml === block.content_html) return block;
        return { ...block, content_html: updatedHtml };
      });

      // Update content_html too
      const updatedContentHtml = article.content_html
        ? (article.content_html as string).replace(yearRegex, String(currentYear))
        : article.content_html;

      // Update dateModified in JSON-LD
      const jsonLd = article.json_ld as Record<string, unknown> | null;
      if (jsonLd) {
        const now = new Date().toISOString();
        if (Array.isArray(jsonLd["@graph"])) {
          for (const item of jsonLd["@graph"] as Record<string, unknown>[]) {
            if (item["@type"] === "Article") {
              item.dateModified = now;
            }
          }
        } else if (jsonLd["@type"] === "Article") {
          jsonLd.dateModified = now;
        }
      }

      // Save to DB
      const { error: updateError } = await supabase
        .from("seo_articles")
        .update({
          content_blocks: updatedBlocks,
          content_html: updatedContentHtml,
          year_tag: currentYear,
          json_ld: jsonLd,
        })
        .eq("id", article.id);

      if (updateError) {
        errors.push({ articleId: article.id, error: updateError.message });
        continue;
      }

      // Optional: push to WordPress
      if (pushToWp && article.wp_post_id) {
        try {
          const assembledHtml = updatedBlocks
            .map((b) => {
              if (b.heading) {
                const tag = b.type === "h2" ? "h2" : b.type === "h3" ? "h3" : b.type === "h4" ? "h4" : "h2";
                return `<${tag}>${b.heading}</${tag}>\n${b.content_html || ""}`;
              }
              return b.content_html || "";
            })
            .join("\n\n");

          await updatePost(siteId, article.wp_post_id as number, {
            content: assembledHtml,
          });
        } catch (wpError) {
          const msg = wpError instanceof Error ? wpError.message : "Erreur WP";
          errors.push({ articleId: article.id, error: `DB OK, WP echoue: ${msg}` });
        }
      }

      updated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      errors.push({ articleId: article.id, error: message });
    }
  }

  return NextResponse.json({ updated, skipped, errors });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { streamAI } from "@/lib/ai/router";
import { buildBlockWriterPrompt } from "@/lib/ai/prompts/block-writer";
import type { ContentBlock } from "@/lib/supabase/types";

const streamBlockSchema = z.object({
  blockIndex: z.number().int().min(0, "blockIndex doit etre >= 0"),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/stream - Stream writing of a single block (SSE)
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
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = streamBlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { blockIndex } = parsed.data;

  // Fetch article with persona and site data
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio, writing_style_examples)"
    )
    .eq("id", articleId)
    .single();

  if (fetchError || !article) {
    if (fetchError?.code === "PGRST116") {
      return NextResponse.json(
        { error: "Article non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: fetchError?.message || "Article non trouve" },
      { status: 500 }
    );
  }

  const contentBlocks = (article.content_blocks || []) as ContentBlock[];
  const block = contentBlocks[blockIndex];
  if (!block) {
    return NextResponse.json(
      { error: `Bloc #${blockIndex} introuvable` },
      { status: 404 }
    );
  }

  // Fetch nuggets for context
  const { data: nuggets } = await supabase
    .from("seo_nuggets")
    .select("id, content, tags")
    .or(`site_id.eq.${article.site_id},site_id.is.null`)
    .limit(5);

  const persona = article.seo_personas as {
    name: string;
    role: string;
    tone_description: string | null;
    bio: string | null;
    writing_style_examples: Record<string, unknown>[];
  } | null;

  const previousHeadings = contentBlocks
    .slice(0, blockIndex)
    .filter((b: ContentBlock) => b.heading)
    .map((b: ContentBlock) => b.heading!);

  // Build prompt
  const prompt = buildBlockWriterPrompt({
    keyword: article.keyword,
    persona: persona || {
      name: "Expert",
      role: "Redacteur",
      tone_description: null,
      bio: null,
      writing_style_examples: [],
    },
    block: {
      type: block.type,
      heading: block.heading || null,
      word_count: block.word_count,
      writing_directive: block.writing_directive,
      format_hint: block.format_hint,
    },
    nuggets: (nuggets || []).map((n) => ({
      id: n.id,
      content: n.content,
      tags: n.tags,
    })),
    previousHeadings,
    articleTitle: article.title || article.keyword,
  });

  // Stream the AI response
  const stream = streamAI(
    "write_block",
    [{ role: "user", content: prompt.user }],
    prompt.system
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

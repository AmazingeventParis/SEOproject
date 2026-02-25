import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import type { ContentBlock } from "@/lib/supabase/types";

const writeBlockSchema = z.object({
  block_id: z.string().uuid("block_id doit etre un UUID valide"),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/write-block - Write a single block by its UUID
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
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

  const parsed = writeBlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  // Find blockIndex from block_id
  const supabase = getServerClient();
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("content_blocks")
    .eq("id", articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  const blocks = (article.content_blocks || []) as ContentBlock[];
  const blockIndex = blocks.findIndex((b) => b.id === parsed.data.block_id);

  if (blockIndex === -1) {
    return NextResponse.json(
      { error: `Bloc "${parsed.data.block_id}" introuvable dans l'article` },
      { status: 404 }
    );
  }

  try {
    const result = await executeStep(articleId, "write_block", { blockIndex });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, runId: result.runId },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

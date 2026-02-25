import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock } from "@/lib/supabase/types";
import type { PipelineRunResult } from "@/lib/pipeline/types";

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/write-all - Write ALL pending blocks sequentially
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  // Read optional model override from body
  let modelOverrideInput: Record<string, unknown> = {};
  try {
    const body = await _request.json();
    if (body?.model) {
      const override = modelIdToOverride(body.model);
      if (override) modelOverrideInput = { modelOverride: override };
    }
  } catch {
    // No body or invalid JSON — use default model
  }

  // Fetch article to get content_blocks
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, content_blocks, status")
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
  if (contentBlocks.length === 0) {
    return NextResponse.json(
      { error: "Aucun bloc de contenu. Generez d'abord un plan." },
      { status: 422 }
    );
  }

  // Find all pending blocks
  const pendingIndices: number[] = [];
  for (let i = 0; i < contentBlocks.length; i++) {
    if (contentBlocks[i].status === "pending") {
      pendingIndices.push(i);
    }
  }

  if (pendingIndices.length === 0) {
    return NextResponse.json(
      { error: "Aucun bloc en attente de redaction." },
      { status: 422 }
    );
  }

  // Write each pending block sequentially
  const results: {
    blockIndex: number;
    success: boolean;
    runId: string;
    error?: string;
  }[] = [];
  let successCount = 0;
  let errorCount = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCostUsd = 0;

  for (const blockIndex of pendingIndices) {
    try {
      const result: PipelineRunResult = await executeStep(
        articleId,
        "write_block",
        { blockIndex, ...modelOverrideInput }
      );

      results.push({
        blockIndex,
        success: result.success,
        runId: result.runId,
        error: result.error,
      });

      if (result.success) {
        successCount++;
        totalTokensIn += result.tokensIn || 0;
        totalTokensOut += result.tokensOut || 0;
        totalCostUsd += result.costUsd || 0;
      } else {
        errorCount++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        blockIndex,
        success: false,
        runId: "",
        error: message,
      });
      errorCount++;
    }
  }

  return NextResponse.json({
    totalBlocks: contentBlocks.length,
    pendingBlocks: pendingIndices.length,
    written: successCount,
    errors: errorCount,
    totalTokensIn,
    totalTokensOut,
    totalCostUsd: Math.round(totalCostUsd * 1000000) / 1000000,
    results,
  });
}

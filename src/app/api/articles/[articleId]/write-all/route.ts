import { NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock } from "@/lib/supabase/types";
import type { PipelineRunResult } from "@/lib/pipeline/types";
import { checkKeyIdeasCoverage } from "@/lib/pipeline/quality-checks";

export const maxDuration = 300;

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/write-all - Write ALL pending blocks with SSE progress
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
    return new Response(
      JSON.stringify({ error: fetchError?.code === "PGRST116" ? "Article non trouve" : (fetchError?.message || "Article non trouve") }),
      { status: fetchError?.code === "PGRST116" ? 404 : 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const contentBlocks = (article.content_blocks || []) as ContentBlock[];
  if (contentBlocks.length === 0) {
    return new Response(
      JSON.stringify({ error: "Aucun bloc de contenu. Generez d'abord un plan." }),
      { status: 422, headers: { "Content-Type": "application/json" } }
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
    return new Response(
      JSON.stringify({ error: "Aucun bloc en attente de redaction." }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  // SSE streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let successCount = 0;
      let errorCount = 0;
      // Track used nugget IDs across blocks to prevent repetition
      const usedNuggetIds: string[] = [];

      for (let i = 0; i < pendingIndices.length; i++) {
        const blockIndex = pendingIndices[i];
        let success = false;

        try {
          const result: PipelineRunResult = await executeStep(
            articleId,
            "write_block",
            { blockIndex, usedNuggetIds, ...modelOverrideInput }
          );
          success = result.success;
          if (success) {
            successCount++;
            // Collect nugget IDs used by this block to exclude from future blocks
            const nuggetIds = (result.output?.nuggetIdsUsed as string[]) || [];
            usedNuggetIds.push(...nuggetIds);
          }
          else {
            errorCount++;
            console.error(`[write-all] Block ${blockIndex} failed:`, result.error || 'unknown');
          }
        } catch (err) {
          errorCount++;
          console.error(`[write-all] Block ${blockIndex} exception:`, err instanceof Error ? err.message : err);
        }

        // Send progress event
        const progressData = JSON.stringify({
          current: i + 1,
          total: pendingIndices.length,
          blockIndex,
          success,
        });
        controller.enqueue(encoder.encode(`event: progress\ndata: ${progressData}\n\n`));
      }

      // Verify key_ideas coverage after writing
      const coverageResults: { blockIndex: number; heading: string | null; coverage: number; missing: string[] }[] = [];

      const { data: updatedArticle } = await supabase
        .from("seo_articles")
        .select("content_blocks")
        .eq("id", articleId)
        .single();

      if (updatedArticle) {
        const blocks = (updatedArticle.content_blocks || []) as ContentBlock[];
        for (let bi = 0; bi < blocks.length; bi++) {
          const block = blocks[bi];
          if (block.key_ideas && block.key_ideas.length > 0 && block.content_html) {
            const result = checkKeyIdeasCoverage(block.content_html, block.key_ideas);
            if (result.coverage < 100) {
              coverageResults.push({
                blockIndex: bi,
                heading: block.heading || null,
                coverage: result.coverage,
                missing: result.missing,
              });
            }
          }
        }
      }

      // Send coverage event before done
      if (coverageResults.length > 0) {
        const coverageData = JSON.stringify({ blocks: coverageResults });
        controller.enqueue(encoder.encode(`event: key_ideas_check\ndata: ${coverageData}\n\n`));
      }

      // Send done event
      const doneData = JSON.stringify({
        written: successCount,
        errors: errorCount,
        totalBlocks: contentBlocks.length,
        keyIdeasCoverage: coverageResults,
      });
      controller.enqueue(encoder.encode(`event: done\ndata: ${doneData}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

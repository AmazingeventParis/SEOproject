import { NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock } from "@/lib/supabase/types";
import { checkKeyIdeasCoverage } from "@/lib/pipeline/quality-checks";
import { detectOverusedPhrases } from "@/lib/seo/phrase-dedup";
import { fetchTemporalContext } from "@/lib/seo/serper";

export const maxDuration = 300;

// Write blocks in parallel batches of 3 for ~3x speedup
const WRITE_BATCH_SIZE = 3;

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
      let progressCounter = 0;
      // Track used nugget IDs across blocks to prevent repetition
      const usedNuggetIds: string[] = [];

      // Detect cross-article overused phrases once before writing
      let detectedTics: string[] = [];
      let temporalContext = "";
      try {
        const { data: artForPersona } = await supabase
          .from("seo_articles")
          .select("persona_id, keyword")
          .eq("id", articleId)
          .single();
        if (artForPersona?.persona_id) {
          const overused = await detectOverusedPhrases(artForPersona.persona_id, articleId);
          detectedTics = overused.map(o => o.phrase);
        }
        // Fetch temporal context (recent news) for this keyword
        if (artForPersona?.keyword) {
          temporalContext = await fetchTemporalContext(artForPersona.keyword);
        }
      } catch (e) {
        console.warn("[write-all] Failed to detect overused phrases or fetch temporal context:", e);
      }

      // Process blocks in parallel batches
      for (let batchStart = 0; batchStart < pendingIndices.length; batchStart += WRITE_BATCH_SIZE) {
        const batchIndices = pendingIndices.slice(batchStart, batchStart + WRITE_BATCH_SIZE);

        // Run batch in parallel with skipSave to avoid DB conflicts
        const batchResults = await Promise.allSettled(
          batchIndices.map(blockIndex =>
            executeStep(articleId, "write_block", {
              blockIndex,
              usedNuggetIds: [...usedNuggetIds],
              detectedTics,
              temporalContext,
              skipSave: true,
              ...modelOverrideInput,
            })
          )
        );

        // Read fresh content_blocks from DB for merging
        const { data: freshArticle } = await supabase
          .from("seo_articles")
          .select("content_blocks")
          .eq("id", articleId)
          .single();

        const blocks = [...((freshArticle?.content_blocks || []) as ContentBlock[])];

        // Process batch results: merge into blocks, collect nugget IDs
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const blockIndex = batchIndices[j];
          let success = false;

          if (result.status === "fulfilled" && result.value.success) {
            success = true;
            successCount++;
            const output = result.value.output;
            const nuggetIds = (output?.nuggetIdsUsed as string[]) || [];
            usedNuggetIds.push(...nuggetIds);

            // Merge written block
            blocks[blockIndex] = {
              ...blocks[blockIndex],
              content_html: output?.processedHtml as string,
              status: "written" as const,
              model_used: result.value.modelUsed,
              word_count: output?.wordCount as number,
            };
          } else {
            errorCount++;
            const errMsg = result.status === "fulfilled"
              ? result.value.error
              : (result.reason instanceof Error ? result.reason.message : String(result.reason));
            console.error(`[write-all] Block ${blockIndex} failed:`, errMsg);
          }

          // Send progress event
          progressCounter++;
          try {
            const progressData = JSON.stringify({
              current: progressCounter,
              total: pendingIndices.length,
              blockIndex,
              success,
            });
            controller.enqueue(encoder.encode(`event: progress\ndata: ${progressData}\n\n`));
          } catch { /* Client disconnected — pipeline continues */ }
        }

        // Save merged blocks after batch
        const totalWords = blocks.reduce((sum, b) => sum + ((b as ContentBlock).word_count || 0), 0);
        await supabase
          .from("seo_articles")
          .update({
            content_blocks: blocks,
            word_count: totalWords,
            status: "writing",
          })
          .eq("id", articleId);
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

      // Send coverage event before done (resilient to client disconnect)
      try {
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
      } catch { /* Client disconnected */ }
      try { controller.close(); } catch { /* Already closed */ }
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

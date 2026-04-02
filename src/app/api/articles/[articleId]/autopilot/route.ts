import { NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep, preGenerateArticleImages } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock, TitleSuggestion, ArticleStatus } from "@/lib/supabase/types";
import { checkKeyIdeasCoverage } from "@/lib/pipeline/quality-checks";
import { detectOverusedPhrases } from "@/lib/seo/phrase-dedup";

export const maxDuration = 600; // 10 minutes for full pipeline

// Write blocks in parallel batches of 3 for ~3x speedup
const WRITE_BATCH_SIZE = 3;

interface RouteContext {
  params: { articleId: string };
}

type AutopilotStep = "analyze" | "plan" | "select_title" | "write" | "media" | "seo";

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: Record<string, unknown>
) {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch {
    // Client disconnected — pipeline continues silently
  }
}

/**
 * POST /api/articles/[articleId]/autopilot
 *
 * Full pipeline automation: analyze → plan → auto-select title → write-all → media → seo
 * Streams SSE events for each step's progress.
 *
 * Optimizations:
 * - Blocks are written in parallel batches of 3 (Gemini 3.1 Flash + LOW thinking)
 * - Image generation starts concurrently with block writing
 *
 * Body (optional):
 *   { model?: string, autoSelectTitle?: number }
 *   - model: model ID override for write steps
 *   - autoSelectTitle: index of title to auto-select (default: 0 = first suggestion)
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  // Parse optional body
  let modelOverride: Record<string, unknown> | undefined;
  let autoSelectTitle = 0;
  try {
    const body = await _request.json();
    if (body?.model) {
      const override = modelIdToOverride(body.model);
      if (override) modelOverride = { modelOverride: override };
    }
    if (typeof body?.autoSelectTitle === "number") {
      autoSelectTitle = body.autoSelectTitle;
    }
  } catch {
    // No body — use defaults
  }

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, status, keyword, persona_id, title, content_blocks, title_suggestions")
    .eq("id", articleId)
    .single();

  if (fetchError || !article) {
    return new Response(
      JSON.stringify({ error: "Article non trouve" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Pre-flight check: persona must be assigned
  if (!article.persona_id) {
    return new Response(
      JSON.stringify({ error: "Un persona doit etre assigne avant de lancer l'autopilot" }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const steps: AutopilotStep[] = [];
      let currentStatus = article.status as ArticleStatus;

      // Determine which steps are needed based on current status
      if (currentStatus === "draft") steps.push("analyze", "plan", "select_title", "write", "media", "seo");
      else if (currentStatus === "analyzing") steps.push("plan", "select_title", "write", "media", "seo");
      else if (currentStatus === "planning") steps.push("select_title", "write", "media", "seo");
      else if (currentStatus === "writing") steps.push("write", "media", "seo");
      else if (currentStatus === "media") steps.push("seo");
      else {
        sendSSE(controller, encoder, "error", { error: `Autopilot non disponible pour le statut "${currentStatus}"` });
        controller.close();
        return;
      }

      // Remove select_title if title already selected
      if (article.title) {
        const idx = steps.indexOf("select_title");
        if (idx !== -1) steps.splice(idx, 1);
      }

      sendSSE(controller, encoder, "start", {
        steps,
        totalSteps: steps.length,
        articleId,
        keyword: article.keyword,
      });

      let aborted = false;
      // Promise for concurrent image pre-generation (axe 5)
      let imagePregenPromise: Promise<Awaited<ReturnType<typeof preGenerateArticleImages>>> | null = null;

      for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
        if (aborted) break;
        const step = steps[stepIdx];

        sendSSE(controller, encoder, "step_start", {
          step,
          stepIndex: stepIdx,
          totalSteps: steps.length,
        });

        try {
          switch (step) {
            case "analyze": {
              const result = await executeStep(articleId, "analyze");
              if (!result.success) {
                sendSSE(controller, encoder, "step_error", { step, error: result.error });
                aborted = true;
                break;
              }
              currentStatus = "analyzing";
              sendSSE(controller, encoder, "step_done", { step, output: result.output });
              break;
            }

            case "plan": {
              const result = await executeStep(articleId, "plan", modelOverride);
              if (!result.success) {
                sendSSE(controller, encoder, "step_error", { step, error: result.error });
                aborted = true;
                break;
              }
              currentStatus = "planning";
              sendSSE(controller, encoder, "step_done", { step, output: result.output });

              // Start image pre-generation concurrently (will run during title selection + writing)
              imagePregenPromise = preGenerateArticleImages(articleId).catch(err => {
                console.warn('[autopilot] Image pre-generation failed:', err instanceof Error ? err.message : err);
                return [];
              });
              break;
            }

            case "select_title": {
              // Auto-select the first (or specified) title suggestion
              const { data: freshArticle } = await supabase
                .from("seo_articles")
                .select("title_suggestions")
                .eq("id", articleId)
                .single();

              const suggestions = (freshArticle?.title_suggestions || []) as TitleSuggestion[];
              if (suggestions.length === 0) {
                sendSSE(controller, encoder, "step_error", { step, error: "Aucune suggestion de titre generee" });
                aborted = true;
                break;
              }

              const titleIdx = Math.min(autoSelectTitle, suggestions.length - 1);
              const selected = suggestions[titleIdx];

              // Fix year in title
              const currentYear = new Date().getFullYear();
              const fixYear = (text: string) =>
                text.replace(/\b(202[0-9])\b/g, (match) =>
                  match === String(currentYear) ? match : String(currentYear)
                );
              const stripYearFromSlug = (slug: string) =>
                slug.replace(/[-]?(202[0-9])[-]?/g, "-").replace(/^-|-$/g, "").replace(/--+/g, "-");

              const updatedSuggestions = suggestions.map((s, i) => ({
                ...s,
                selected: i === titleIdx,
              }));

              await supabase
                .from("seo_articles")
                .update({
                  title: fixYear(selected.title),
                  slug: stripYearFromSlug(selected.slug),
                  seo_title: fixYear(selected.seo_title || selected.title),
                  title_suggestions: updatedSuggestions,
                })
                .eq("id", articleId);

              sendSSE(controller, encoder, "step_done", {
                step,
                output: { selectedTitle: fixYear(selected.title), titleIndex: titleIdx },
              });
              break;
            }

            case "write": {
              // Write all pending blocks in parallel batches with nugget tracking
              const { data: writeArticle } = await supabase
                .from("seo_articles")
                .select("content_blocks")
                .eq("id", articleId)
                .single();

              const contentBlocks = ((writeArticle?.content_blocks || []) as ContentBlock[]);
              const pendingIndices: number[] = [];
              for (let i = 0; i < contentBlocks.length; i++) {
                if (contentBlocks[i].status === "pending") pendingIndices.push(i);
              }

              if (pendingIndices.length === 0) {
                sendSSE(controller, encoder, "step_done", { step, output: { written: 0, skipped: true } });
                break;
              }

              let written = 0;
              let errors = 0;
              const usedNuggetIds: string[] = [];
              let progressCounter = 0;

              // Detect cross-article overused phrases once before writing
              let detectedTics: string[] = [];
              try {
                const { data: artForPersona } = await supabase
                  .from("seo_articles")
                  .select("persona_id")
                  .eq("id", articleId)
                  .single();
                if (artForPersona?.persona_id) {
                  const overused = await detectOverusedPhrases(artForPersona.persona_id, articleId);
                  detectedTics = overused.map(o => o.phrase);
                }
              } catch (e) {
                console.warn("[autopilot] Failed to detect overused phrases:", e);
              }

              // Process blocks in parallel batches
              for (let batchStart = 0; batchStart < pendingIndices.length; batchStart += WRITE_BATCH_SIZE) {
                const batchIndices = pendingIndices.slice(batchStart, batchStart + WRITE_BATCH_SIZE);

                // Run batch in parallel with skipSave
                const batchResults = await Promise.allSettled(
                  batchIndices.map(blockIndex =>
                    executeStep(articleId, "write_block", {
                      blockIndex,
                      usedNuggetIds: [...usedNuggetIds],
                      detectedTics,
                      skipSave: true,
                      ...modelOverride,
                    })
                  )
                );

                // Read fresh blocks from DB for merging
                const { data: freshBlocks } = await supabase
                  .from("seo_articles")
                  .select("content_blocks")
                  .eq("id", articleId)
                  .single();

                const blocks = [...((freshBlocks?.content_blocks || []) as ContentBlock[])];

                // Process batch results
                for (let j = 0; j < batchResults.length; j++) {
                  const result = batchResults[j];
                  const blockIndex = batchIndices[j];

                  if (result.status === "fulfilled" && result.value.success) {
                    written++;
                    const output = result.value.output;
                    const nuggetIds = (output?.nuggetIdsUsed as string[]) || [];
                    usedNuggetIds.push(...nuggetIds);

                    blocks[blockIndex] = {
                      ...blocks[blockIndex],
                      content_html: output?.processedHtml as string,
                      status: "written" as const,
                      model_used: result.value.modelUsed,
                      word_count: output?.wordCount as number,
                    };
                  } else {
                    errors++;
                  }

                  progressCounter++;
                  sendSSE(controller, encoder, "write_progress", {
                    current: progressCounter,
                    total: pendingIndices.length,
                    blockIndex,
                  });
                }

                // Save merged blocks after batch
                const totalWords = blocks.reduce((sum, b) => sum + ((b as ContentBlock).word_count || 0), 0);
                await supabase
                  .from("seo_articles")
                  .update({ content_blocks: blocks, word_count: totalWords, status: "writing" })
                  .eq("id", articleId);
              }

              // Key ideas coverage check
              const coverageResults: { blockIndex: number; heading: string | null; coverage: number; missing: string[] }[] = [];
              const { data: writtenArticle } = await supabase
                .from("seo_articles")
                .select("content_blocks")
                .eq("id", articleId)
                .single();

              if (writtenArticle) {
                const blocks = (writtenArticle.content_blocks || []) as ContentBlock[];
                for (let bi = 0; bi < blocks.length; bi++) {
                  const block = blocks[bi];
                  if (block.key_ideas && block.key_ideas.length > 0 && block.content_html) {
                    const check = checkKeyIdeasCoverage(block.content_html, block.key_ideas);
                    if (check.coverage < 100) {
                      coverageResults.push({
                        blockIndex: bi,
                        heading: block.heading || null,
                        coverage: check.coverage,
                        missing: check.missing,
                      });
                    }
                  }
                }
              }

              sendSSE(controller, encoder, "step_done", {
                step,
                output: { written, errors, keyIdeasCoverage: coverageResults },
              });
              break;
            }

            case "media": {
              // Use pre-generated images if available (from concurrent generation during writing)
              let mediaInput: Record<string, unknown> | undefined;
              if (imagePregenPromise) {
                try {
                  const pregenImages = await imagePregenPromise;
                  if (pregenImages.length > 0) {
                    mediaInput = { preGeneratedImages: pregenImages };
                  }
                } catch {
                  // Pre-generation failed, fall back to normal media step
                }
                imagePregenPromise = null;
              }

              const result = await executeStep(articleId, "media", mediaInput);
              if (!result.success) {
                sendSSE(controller, encoder, "step_error", { step, error: result.error });
                aborted = true;
                break;
              }
              sendSSE(controller, encoder, "step_done", { step, output: result.output });
              break;
            }

            case "seo": {
              const result = await executeStep(articleId, "seo");
              if (!result.success) {
                sendSSE(controller, encoder, "step_error", { step, error: result.error });
                aborted = true;
                break;
              }
              sendSSE(controller, encoder, "step_done", { step, output: result.output });
              break;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendSSE(controller, encoder, "step_error", { step, error: message });
          aborted = true;
        }
      }

      // Send final done event
      sendSSE(controller, encoder, "done", {
        success: !aborted,
        stepsCompleted: aborted ? steps.indexOf(steps.find((_, i) => i === steps.length) || steps[0]) : steps.length,
      });
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

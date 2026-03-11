import { NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock, TitleSuggestion, ArticleStatus } from "@/lib/supabase/types";
import type { PipelineRunResult } from "@/lib/pipeline/types";
import { checkKeyIdeasCoverage } from "@/lib/pipeline/quality-checks";

export const maxDuration = 600; // 10 minutes for full pipeline

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
              // Write all pending blocks sequentially with nugget tracking
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

              for (let i = 0; i < pendingIndices.length; i++) {
                const blockIndex = pendingIndices[i];
                try {
                  const result: PipelineRunResult = await executeStep(
                    articleId,
                    "write_block",
                    { blockIndex, usedNuggetIds, ...modelOverride }
                  );
                  if (result.success) {
                    written++;
                    const nuggetIds = (result.output?.nuggetIdsUsed as string[]) || [];
                    usedNuggetIds.push(...nuggetIds);
                  } else {
                    errors++;
                  }
                } catch {
                  errors++;
                }

                sendSSE(controller, encoder, "write_progress", {
                  current: i + 1,
                  total: pendingIndices.length,
                  blockIndex,
                });
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
              const result = await executeStep(articleId, "media");
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

import { NextRequest } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";
import type { ContentBlock, TitleSuggestion, ArticleStatus } from "@/lib/supabase/types";
import type { PipelineRunResult } from "@/lib/pipeline/types";
import { detectOverusedPhrases } from "@/lib/seo/phrase-dedup";
import { fetchTemporalContext } from "@/lib/seo/serper";

export const maxDuration = 600; // 10 minutes

const queueSchema = z.object({
  articleIds: z.array(z.string().uuid()).min(1).max(20),
  model: z.string().optional(),
  concurrency: z.number().int().min(1).max(3).optional(),
  autoSelectTitle: z.number().int().min(0).max(2).optional(),
});

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
 * Run the full pipeline for a single article (analyze → plan → select title → write-all → media → seo).
 * Returns a summary of the run.
 */
async function runArticlePipeline(
  articleId: string,
  modelOverride?: Record<string, unknown>,
  autoSelectTitle = 0,
): Promise<{ success: boolean; error?: string; stepsCompleted: string[] }> {
  const supabase = getServerClient();
  const stepsCompleted: string[] = [];

  // Fetch article
  const { data: article } = await supabase
    .from("seo_articles")
    .select("id, status, persona_id, title, title_suggestions, content_blocks")
    .eq("id", articleId)
    .single();

  if (!article) return { success: false, error: "Article non trouve", stepsCompleted };
  if (!article.persona_id) return { success: false, error: "Aucun persona assigne", stepsCompleted };

  let status = article.status as ArticleStatus;

  // Step 1: Analyze (if draft)
  if (status === "draft") {
    const result = await executeStep(articleId, "analyze");
    if (!result.success) return { success: false, error: `Analyse: ${result.error}`, stepsCompleted };
    stepsCompleted.push("analyze");
    status = "analyzing";
  }

  // Step 2: Plan (if analyzing)
  if (status === "analyzing") {
    const result = await executeStep(articleId, "plan", modelOverride);
    if (!result.success) return { success: false, error: `Plan: ${result.error}`, stepsCompleted };
    stepsCompleted.push("plan");
    status = "planning";
  }

  // Step 3: Auto-select title (if planning and no title)
  if (status === "planning" && !article.title) {
    const { data: freshArticle } = await supabase
      .from("seo_articles")
      .select("title_suggestions")
      .eq("id", articleId)
      .single();

    const suggestions = (freshArticle?.title_suggestions || []) as TitleSuggestion[];
    if (suggestions.length > 0) {
      const titleIdx = Math.min(autoSelectTitle, suggestions.length - 1);
      const selected = suggestions[titleIdx];
      const currentYear = new Date().getFullYear();
      const fixYear = (t: string) => t.replace(/\b(202[0-9])\b/g, (m) => m === String(currentYear) ? m : String(currentYear));
      const stripYearFromSlug = (s: string) => s.replace(/[-]?(202[0-9])[-]?/g, "-").replace(/^-|-$/g, "").replace(/--+/g, "-");

      await supabase
        .from("seo_articles")
        .update({
          title: fixYear(selected.title),
          slug: stripYearFromSlug(selected.slug),
          seo_title: fixYear(selected.seo_title || selected.title),
          title_suggestions: suggestions.map((s, i) => ({ ...s, selected: i === titleIdx })),
        })
        .eq("id", articleId);
      stepsCompleted.push("select_title");
    }
  }

  // Step 4: Write all blocks
  if (status === "planning" || status === "writing") {
    const { data: writeArticle } = await supabase
      .from("seo_articles")
      .select("content_blocks")
      .eq("id", articleId)
      .single();

    const contentBlocks = (writeArticle?.content_blocks || []) as ContentBlock[];
    const pendingIndices: number[] = [];
    for (let i = 0; i < contentBlocks.length; i++) {
      if (contentBlocks[i].status === "pending") pendingIndices.push(i);
    }

    if (pendingIndices.length > 0) {
      const usedNuggetIds: string[] = [];
      // Detect cross-article overused phrases + temporal context once
      let detectedTics: string[] = [];
      let temporalContext = "";
      try {
        const { data: artP } = await supabase
          .from("seo_articles")
          .select("persona_id, keyword")
          .eq("id", articleId)
          .single();
        if (artP?.persona_id) {
          const overused = await detectOverusedPhrases(artP.persona_id, articleId);
          detectedTics = overused.map(o => o.phrase);
        }
        if (artP?.keyword) {
          temporalContext = await fetchTemporalContext(artP.keyword);
        }
      } catch { /* continue without tics/temporal detection */ }
      for (const blockIndex of pendingIndices) {
        try {
          const result: PipelineRunResult = await executeStep(
            articleId,
            "write_block",
            { blockIndex, usedNuggetIds, detectedTics, temporalContext, ...modelOverride }
          );
          if (result.success) {
            const nuggetIds = (result.output?.nuggetIdsUsed as string[]) || [];
            usedNuggetIds.push(...nuggetIds);
          }
        } catch {
          // Continue writing other blocks on error
        }
      }
    }
    stepsCompleted.push("write");
    status = "writing";
  }

  // Step 5: Media
  if (status === "writing") {
    const result = await executeStep(articleId, "media");
    if (!result.success) return { success: false, error: `Media: ${result.error}`, stepsCompleted };
    stepsCompleted.push("media");
    status = "media";
  }

  // Step 6: SEO
  if (status === "media" || status === "seo_check") {
    const result = await executeStep(articleId, "seo");
    if (!result.success) return { success: false, error: `SEO: ${result.error}`, stepsCompleted };
    stepsCompleted.push("seo");
  }

  return { success: true, stepsCompleted };
}

/**
 * POST /api/articles/queue
 *
 * Process multiple articles through the full pipeline with controlled concurrency.
 * Streams SSE events for each article's progress.
 *
 * Body:
 *   { articleIds: string[], model?: string, concurrency?: number (1-3, default 2), autoSelectTitle?: number }
 */
export async function POST(_request: NextRequest) {
  let body: unknown;
  try {
    body = await _request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Corps de requete invalide" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const parsed = queueSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Validation echouee", details: parsed.error.format() }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const { articleIds, model, concurrency = 2, autoSelectTitle = 0 } = parsed.data;

  let modelOverride: Record<string, unknown> | undefined;
  if (model) {
    const override = modelIdToOverride(model);
    if (override) modelOverride = { modelOverride: override };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      sendSSE(controller, encoder, "start", {
        totalArticles: articleIds.length,
        concurrency,
      });

      let completed = 0;
      let succeeded = 0;
      let failed = 0;

      // Process articles with limited concurrency using a semaphore pattern
      const queue = [...articleIds];
      const running = new Set<Promise<void>>();

      async function processNext() {
        if (queue.length === 0) return;
        const artId = queue.shift()!;

        sendSSE(controller, encoder, "article_start", {
          articleId: artId,
          index: articleIds.indexOf(artId),
          total: articleIds.length,
        });

        try {
          const result = await runArticlePipeline(artId, modelOverride, autoSelectTitle);

          completed++;
          if (result.success) succeeded++;
          else failed++;

          sendSSE(controller, encoder, "article_done", {
            articleId: artId,
            success: result.success,
            error: result.error,
            stepsCompleted: result.stepsCompleted,
            completed,
            total: articleIds.length,
          });
        } catch (err) {
          completed++;
          failed++;
          sendSSE(controller, encoder, "article_done", {
            articleId: artId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            stepsCompleted: [],
            completed,
            total: articleIds.length,
          });
        }
      }

      // Start initial batch
      while (running.size < concurrency && queue.length > 0) {
        const p = processNext().then(() => { running.delete(p); });
        running.add(p);
      }

      // Process remaining articles as slots free up
      while (running.size > 0 || queue.length > 0) {
        if (running.size > 0) {
          await Promise.race(running);
        }
        while (running.size < concurrency && queue.length > 0) {
          const p = processNext().then(() => { running.delete(p); });
          running.add(p);
        }
      }

      sendSSE(controller, encoder, "done", {
        totalArticles: articleIds.length,
        succeeded,
        failed,
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

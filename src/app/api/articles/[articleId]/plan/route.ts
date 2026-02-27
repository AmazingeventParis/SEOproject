import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { modelIdToOverride } from "@/lib/ai/router";

const contentBlockSchema = z.object({
  id: z.string(),
  type: z.enum(["h2", "h3", "h4", "paragraph", "list", "faq", "callout", "image"]),
  heading: z.string().optional(),
  content_html: z.string(),
  nugget_ids: z.array(z.string()),
  word_count: z.number(),
  model_used: z.string().optional(),
  status: z.enum(["pending", "written", "approved"]),
});

const updatePlanSchema = z.object({
  content_blocks: z.array(contentBlockSchema),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/plan - Generate article plan via AI
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { articleId } = params;

  try {
    // Read optional model override from body
    let modelOverride: Record<string, unknown> | undefined;
    try {
      const body = await _request.json();
      if (body?.model) {
        const override = modelIdToOverride(body.model);
        if (override) modelOverride = { modelOverride: override };
      }
    } catch {
      // No body or invalid JSON — use default model
    }

    const result = await executeStep(articleId, "plan", modelOverride);

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

// PATCH /api/articles/[articleId]/plan - Manually update the plan (drag-and-drop reordering)
export async function PATCH(
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

  const parsed = updatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from("seo_articles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ content_blocks: parsed.data.content_blocks as any })
    .eq("id", articleId)
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain), seo_personas!seo_articles_persona_id_fkey(name, role)"
    )
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Article non trouve" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

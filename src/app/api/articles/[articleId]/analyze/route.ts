import { NextRequest, NextResponse } from "next/server";
import { executeStep } from "@/lib/pipeline/orchestrator";
import { pipelinePreflight } from "@/lib/ai/preflight";

export const maxDuration = 120;

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/analyze - Trigger SERP analysis
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const blocked = await pipelinePreflight();
  if (blocked) return blocked;

  const { articleId } = params;

  try {
    const result = await executeStep(articleId, "analyze");

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

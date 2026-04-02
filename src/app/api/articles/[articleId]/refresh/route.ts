import { NextRequest, NextResponse } from "next/server";
import { executeStep } from "@/lib/pipeline/orchestrator";

export const maxDuration = 120;

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/refresh - Trigger content refresh
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const { articleId } = params;

  let input: Record<string, unknown> = {};
  try {
    input = await request.json();
  } catch {
    // no body is fine
  }

  try {
    const result = await executeStep(articleId, "refresh", input);

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

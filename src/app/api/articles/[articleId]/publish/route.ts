import { NextRequest, NextResponse } from "next/server";
import { executeStep } from "@/lib/pipeline/orchestrator";

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/publish - Trigger WordPress publication
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { articleId } = params;

  try {
    const result = await executeStep(articleId, "publish");

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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { executeStep } from "@/lib/pipeline/orchestrator";

const writeBlockSchema = z.object({
  blockIndex: z.number().int().min(0, "blockIndex doit etre >= 0"),
});

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/write - Write a single content block
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
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

  const parsed = writeBlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  try {
    const result = await executeStep(articleId, "write_block", {
      blockIndex: parsed.data.blockIndex,
    });

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

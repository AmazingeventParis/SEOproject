import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRefreshCandidates, markForRefresh } from "@/lib/seo/refresh-detector";

const refreshScanSchema = z.object({
  site_id: z.string().uuid("L'identifiant du site doit etre un UUID valide"),
  auto_mark: z.boolean().optional(),
});

// POST /api/articles/refresh-scan - Scan for articles needing refresh
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = refreshScanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  try {
    const candidates = await getRefreshCandidates(parsed.data.site_id);

    let marked = 0;
    if (parsed.data.auto_mark && candidates.length > 0) {
      const candidateIds = candidates.map((c) => c.id);
      marked = await markForRefresh(candidateIds);
    }

    return NextResponse.json({ candidates, marked });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne du serveur";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

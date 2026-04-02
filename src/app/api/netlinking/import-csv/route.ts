import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { parseSemrushCSV, getKeywordsSummary } from "@/lib/netlinking/csv-parser";

const importSchema = z.object({
  opportunity_id: z.string().uuid(),
  csv_content: z.string().min(10, "Le CSV est trop court"),
});

// POST /api/netlinking/import-csv — Import Semrush keywords for an opportunity
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  const { opportunity_id, csv_content } = parsed.data;

  try {
    const keywords = parseSemrushCSV(csv_content);
    if (keywords.length === 0) {
      return NextResponse.json({ error: "Aucun mot-cle trouve dans le CSV. Verifiez le format." }, { status: 422 });
    }

    const summary = getKeywordsSummary(keywords);

    // Update opportunity with parsed keywords
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_link_opportunities" as any)
      .update({
        vendor_keywords: keywords,
        organic_traffic: summary?.total_traffic || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", opportunity_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      opportunity: data,
      keywords_imported: keywords.length,
      summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Erreur import CSV : ${msg}` }, { status: 500 });
  }
}

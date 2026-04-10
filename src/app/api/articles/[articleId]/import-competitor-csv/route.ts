import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { parseSemrushCsv } from "@/lib/keywords/csv-parser";

interface RouteContext {
  params: { articleId: string };
}

/**
 * POST /api/articles/[articleId]/import-competitor-csv
 * Import Semrush CSV data for competitor URLs to enrich TF-IDF + semantic field.
 * Body: { csvTexts: { url: string; csv: string }[] }
 * Merges competitor keywords into serp_data.competitorContent.tfidfKeywords + semanticAnalysis.semanticField
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  const body = await request.json();
  const csvTexts = body.csvTexts as { url: string; csv: string }[];

  if (!csvTexts || !Array.isArray(csvTexts) || csvTexts.length === 0) {
    return NextResponse.json({ error: "csvTexts array required" }, { status: 400 });
  }

  if (csvTexts.length > 5) {
    return NextResponse.json({ error: "Maximum 5 CSV" }, { status: 400 });
  }

  // Fetch article
  const { data: article, error } = await supabase
    .from("seo_articles")
    .select("id, serp_data")
    .eq("id", articleId)
    .single();

  if (error || !article) {
    return NextResponse.json({ error: "Article non trouve" }, { status: 404 });
  }

  // Parse all CSVs and merge keywords
  const allKeywords: Map<string, { term: string; totalVolume: number; avgPosition: number; sources: number; totalTraffic: number }> = new Map();
  const importResults: { url: string; keywordsFound: number }[] = [];

  for (const { url, csv } of csvTexts) {
    try {
      const parsed = parseSemrushCsv(csv);
      importResults.push({ url, keywordsFound: parsed.length });

      for (const kw of parsed) {
        const key = kw.keyword.toLowerCase().trim();
        const existing = allKeywords.get(key);
        if (existing) {
          existing.totalVolume = Math.max(existing.totalVolume, kw.volume);
          existing.sources += 1;
          existing.totalTraffic += (kw as { traffic?: number }).traffic || 0;
        } else {
          allKeywords.set(key, {
            term: kw.keyword,
            totalVolume: kw.volume,
            avgPosition: (kw as { position?: number }).position || 0,
            sources: 1,
            totalTraffic: (kw as { traffic?: number }).traffic || 0,
          });
        }
      }
    } catch {
      importResults.push({ url, keywordsFound: 0 });
    }
  }

  // Score and sort: keywords present in multiple competitors + high volume = most important
  const scoredKeywords = Array.from(allKeywords.values())
    .map(kw => ({
      ...kw,
      score: (kw.sources * 10) + Math.log10(Math.max(1, kw.totalVolume)) + (kw.totalTraffic > 0 ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  // Build enriched TF-IDF terms (top 50)
  const enrichedTfidf = scoredKeywords.slice(0, 50).map(kw => ({
    term: kw.term,
    tfidf: kw.score / 100, // normalized score
    df: kw.sources,
    volume: kw.totalVolume,
  }));

  // Build enriched semantic field (top 20 keyword labels)
  const enrichedSemanticField = scoredKeywords
    .slice(0, 20)
    .map(kw => kw.term);

  // Merge into existing serp_data
  const existingSerpData = (article.serp_data || {}) as Record<string, unknown>;
  const existingCompetitor = (existingSerpData.competitorContent || {}) as Record<string, unknown>;
  const existingSemantic = (existingSerpData.semanticAnalysis || {}) as Record<string, unknown>;

  // Merge TF-IDF: keep existing (from scrape) + add CSV-enriched
  const existingTfidf = (existingCompetitor.tfidfKeywords || []) as { term: string; tfidf: number; df: number }[];
  const existingTerms = new Set(existingTfidf.map(t => t.term.toLowerCase()));
  const mergedTfidf = [
    ...existingTfidf,
    ...enrichedTfidf.filter(t => !existingTerms.has(t.term.toLowerCase())),
  ].sort((a, b) => b.tfidf - a.tfidf).slice(0, 60);

  // Merge semantic field
  const existingField = (existingSemantic.semanticField || []) as string[];
  const existingFieldSet = new Set(existingField.map(t => t.toLowerCase()));
  const mergedField = [
    ...existingField,
    ...enrichedSemanticField.filter(t => !existingFieldSet.has(t.toLowerCase())),
  ].slice(0, 30);

  // Update serp_data
  const updatedSerpData = {
    ...existingSerpData,
    competitorContent: {
      ...existingCompetitor,
      tfidfKeywords: mergedTfidf,
      csvEnriched: true,
      csvImportedAt: new Date().toISOString(),
      csvSources: importResults,
    },
    semanticAnalysis: {
      ...existingSemantic,
      semanticField: mergedField,
    },
  };

  await supabase
    .from("seo_articles")
    .update({ serp_data: updatedSerpData })
    .eq("id", articleId);

  return NextResponse.json({
    success: true,
    totalKeywordsExtracted: allKeywords.size,
    tfidfTerms: mergedTfidf.length,
    semanticFieldTerms: mergedField.length,
    imports: importResults,
  });
}

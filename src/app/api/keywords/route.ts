import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { parseSemrushCsv } from "@/lib/keywords/csv-parser";
import { computePriorityScore, classifyIntent, type GrowthPhase } from "@/lib/keywords/scoring";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

// GET /api/keywords — List keywords with filters
export async function GET(request: NextRequest) {
  const supabase = getServerClient() as AnyQuery;
  const { searchParams } = new URL(request.url);

  const siteId = searchParams.get("site_id");
  const siloId = searchParams.get("silo_id");
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") || "priority_score";
  const order = searchParams.get("order") || "desc";
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  let query = supabase
    .from("seo_keyword_research")
    .select("*, seo_silos(name)", { count: "exact" });

  if (siteId) query = query.eq("site_id", siteId);
  if (siloId) query = query.eq("silo_id", siloId);
  if (status) query = query.eq("status", status);

  query = query.order(sort, { ascending: order === "asc" });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keywords: data, total: count });
}

// POST /api/keywords — Import CSV or add manual keyword
export async function POST(request: NextRequest) {
  const supabase = getServerClient() as AnyQuery;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();

    // CSV import mode
    if (body.csv && body.site_id) {
      return handleCsvImport(supabase, body.site_id, body.csv, body.silo_id || null, body.batch_name || null);
    }

    // Manual keyword
    if (body.keyword && body.site_id) {
      const intent = classifyIntent(body.keyword);
      const { data, error } = await supabase
        .from("seo_keyword_research")
        .upsert({
          site_id: body.site_id,
          keyword: body.keyword.trim().toLowerCase(),
          volume: body.volume || 0,
          difficulty: body.difficulty || 0,
          cpc: body.cpc || 0,
          search_intent: body.search_intent || intent,
          silo_id: body.silo_id || null,
          source: "manual",
          status: "new",
        }, { onConflict: "site_id,keyword" })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Missing keyword or csv field" }, { status: 400 });
  }

  return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 400 });
}

// PATCH /api/keywords — Bulk update (status, silo, re-score)
export async function PATCH(request: NextRequest) {
  const supabase = getServerClient() as AnyQuery;
  const body = await request.json();

  // Re-score all keywords for a site
  if (body.action === "rescore" && body.site_id) {
    return handleRescore(supabase, body.site_id);
  }

  // Bulk status update
  if (body.ids && body.status) {
    const { error } = await supabase
      .from("seo_keyword_research")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .in("id", body.ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: body.ids.length });
  }

  // Bulk silo assignment
  if (body.ids && body.silo_id !== undefined) {
    const { error } = await supabase
      .from("seo_keyword_research")
      .update({ silo_id: body.silo_id || null, updated_at: new Date().toISOString() })
      .in("id", body.ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: body.ids.length });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/keywords — Delete keywords
export async function DELETE(request: NextRequest) {
  const supabase = getServerClient() as AnyQuery;
  const body = await request.json();

  if (body.ids && Array.isArray(body.ids)) {
    const { error } = await supabase
      .from("seo_keyword_research")
      .delete()
      .in("id", body.ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: body.ids.length });
  }

  return NextResponse.json({ error: "Missing ids array" }, { status: 400 });
}

// ---- CSV Import handler ----

async function handleCsvImport(
  supabase: AnyQuery,
  siteId: string,
  csvText: string,
  siloId: string | null,
  batchName: string | null,
) {
  // 1. Parse CSV
  let parsed;
  try {
    parsed = parseSemrushCsv(csvText);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (parsed.length === 0) {
    return NextResponse.json({ error: "Aucun mot-cle trouve dans le CSV" }, { status: 400 });
  }

  // 2. Get site growth phase
  const { data: site } = await supabase
    .from("seo_sites")
    .select("growth_phase")
    .eq("id", siteId)
    .single();
  const phase = (site?.growth_phase || "sandbox") as GrowthPhase;

  // 3. Get existing articles for cannibalization check
  const { data: existingArticles } = await supabase
    .from("seo_articles")
    .select("id, keyword, title, status")
    .eq("site_id", siteId);

  // 4. Get max volume for normalization
  const maxVolume = Math.max(1, ...parsed.map(p => p.volume));

  // 5. Prepare upsert data with scoring + cannibalization
  const batchId = batchName || `import-${new Date().toISOString().slice(0, 16)}`;
  const upsertData = parsed.map(kw => {
    const intent = classifyIntent(kw.keyword, kw.intent);
    const priorityScore = computePriorityScore({
      volume: kw.volume,
      difficulty: kw.difficulty,
      cpc: kw.cpc,
      siloId,
      searchIntent: intent,
    }, phase, maxVolume);

    const cannibalization = checkCannibalization(kw.keyword, existingArticles || []);

    return {
      site_id: siteId,
      keyword: kw.keyword.toLowerCase().trim(),
      volume: kw.volume,
      difficulty: kw.difficulty,
      cpc: kw.cpc,
      search_intent: intent,
      competition: kw.competition ?? null,
      serp_results: kw.results ?? null,
      priority_score: priorityScore,
      silo_id: siloId,
      source: "semrush",
      import_batch: batchId,
      cannibalization_risk: cannibalization,
      status: cannibalization ? "dismissed" : "new",
      updated_at: new Date().toISOString(),
    };
  });

  // 6. Upsert in batches of 50
  let totalImported = 0;
  for (let i = 0; i < upsertData.length; i += 50) {
    const batch = upsertData.slice(i, i + 50);
    const { data, error } = await supabase
      .from("seo_keyword_research")
      .upsert(batch, { onConflict: "site_id,keyword" })
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message, imported_so_far: totalImported }, { status: 500 });
    }
    totalImported += data?.length || 0;
  }

  const cannibalized = upsertData.filter(d => d.cannibalization_risk).length;

  return NextResponse.json({
    imported: totalImported,
    total_parsed: parsed.length,
    cannibalized,
    batch: batchId,
    phase,
  });
}

// ---- Re-score handler ----

async function handleRescore(
  supabase: AnyQuery,
  siteId: string,
) {
  const { data: site } = await supabase
    .from("seo_sites")
    .select("growth_phase")
    .eq("id", siteId)
    .single();
  const phase = (site?.growth_phase || "sandbox") as GrowthPhase;

  const { data: keywords, error } = await supabase
    .from("seo_keyword_research")
    .select("id, keyword, volume, difficulty, cpc, kgr, current_position, silo_id, search_intent")
    .eq("site_id", siteId);

  if (error || !keywords) {
    return NextResponse.json({ error: error?.message || "No keywords" }, { status: 500 });
  }

  // Get existing articles for cannibalization re-check
  const { data: existingArticles } = await supabase
    .from("seo_articles")
    .select("id, keyword, title, status")
    .eq("site_id", siteId);

  const maxVolume = Math.max(1, ...keywords.map((k: Record<string, number>) => k.volume));

  // Re-score in batch
  const updates = keywords.map((kw: Record<string, unknown>) => {
    const score = computePriorityScore({
      volume: kw.volume as number,
      difficulty: kw.difficulty as number,
      cpc: parseFloat(String(kw.cpc)) || 0,
      kgr: kw.kgr ? parseFloat(String(kw.kgr)) : undefined,
      currentPosition: kw.current_position ? parseFloat(String(kw.current_position)) : undefined,
      siloId: kw.silo_id as string | null,
      searchIntent: kw.search_intent as string,
    }, phase, maxVolume);

    const cannibalization = checkCannibalization(kw.keyword as string, existingArticles || []);

    return { id: kw.id, priority_score: score, cannibalization_risk: cannibalization || null };
  });

  // Update each
  for (const upd of updates) {
    await supabase
      .from("seo_keyword_research")
      .update({ priority_score: upd.priority_score, cannibalization_risk: upd.cannibalization_risk, updated_at: new Date().toISOString() })
      .eq("id", upd.id);
  }

  return NextResponse.json({ rescored: updates.length, phase });
}

// ---- Cannibalization check ----

function checkCannibalization(
  keyword: string,
  existingArticles: { id: string; keyword: string; title: string | null; status: string }[],
): { articleId: string; articleKeyword: string; articleTitle: string | null; similarity: string } | null {
  const kwLower = keyword.toLowerCase().trim();
  const kwWords = kwLower.split(/\s+/).filter(w => w.length > 2);
  if (kwWords.length === 0) return null;

  for (const article of existingArticles) {
    if (!article.keyword) continue;
    const artKw = article.keyword.toLowerCase().trim();

    // Exact match
    if (kwLower === artKw) {
      return {
        articleId: article.id,
        articleKeyword: article.keyword,
        articleTitle: article.title,
        similarity: '100%',
      };
    }

    // Word overlap
    const artWords = artKw.split(/\s+/).filter(w => w.length > 2);
    if (artWords.length === 0) continue;

    const overlap = kwWords.filter(w => artWords.some(aw => aw.includes(w) || w.includes(aw))).length;
    const overlapRatio = overlap / Math.max(kwWords.length, artWords.length);

    if (overlapRatio >= 0.6) {
      return {
        articleId: article.id,
        articleKeyword: article.keyword,
        articleTitle: article.title,
        similarity: (overlapRatio * 100).toFixed(0) + '%',
      };
    }
  }

  return null;
}

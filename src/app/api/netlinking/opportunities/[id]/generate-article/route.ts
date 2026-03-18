import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { generateNetlinkingArticle } from "@/lib/netlinking/analyzer";

export const maxDuration = 120;

interface RouteContext {
  params: { id: string };
}

// POST /api/netlinking/opportunities/[id]/generate-article
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppRaw, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .select("*, seo_sites!seo_link_opportunities_site_id_fkey(name, domain, niche)")
    .eq("id", params.id)
    .single();

  if (error || !oppRaw) {
    return NextResponse.json({ error: "Opportunite non trouvee" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opp = oppRaw as any;

  if (!opp.target_page || !opp.target_keyword) {
    return NextResponse.json({ error: "target_page et target_keyword sont requis" }, { status: 422 });
  }

  const site = opp.seo_sites as { name: string; domain: string; niche: string | null } | null;

  // Check existing anchor distribution from purchases
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchasesRaw } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_purchases" as any)
    .select("anchor_type")
    .eq("site_id", opp.site_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const purchases = purchasesRaw as any[];

  let anchorProfile: { exact: number; broad: number; brand: number } | undefined;
  if (purchases && purchases.length > 0) {
    anchorProfile = { exact: 0, broad: 0, brand: 0 };
    for (const p of purchases) {
      if (p.anchor_type === "exact") anchorProfile.exact++;
      else if (p.anchor_type === "broad") anchorProfile.broad++;
      else if (p.anchor_type === "brand") anchorProfile.brand++;
    }
  }

  try {
    const article = await generateNetlinkingArticle({
      vendorDomain: opp.vendor_domain,
      vendorNiche: opp.niche,
      targetPageUrl: opp.target_page,
      targetKeyword: opp.target_keyword,
      siteDomain: site?.domain || "",
      siteNiche: site?.niche || "generaliste",
      anchorProfile,
    });

    // Save to opportunity
    const { data: updated, error: updateError } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("seo_link_opportunities" as any)
      .update({
        generated_article: article,
        anchor_suggestions: article.anchors,
        status: "article_generated",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", params.id)
      .select()
      .single();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Erreur generation : ${msg}` }, { status: 500 });
  }
}

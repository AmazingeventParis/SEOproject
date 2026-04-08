import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { generateGuestPostArticle } from "@/lib/netlinking/guest-post-generator";
import type { GuestPostLink } from "@/lib/netlinking/types";

export const maxDuration = 120;

interface RouteContext {
  params: { id: string };
}

// POST /api/netlinking/opportunities/[id]/generate-article
// Body (optional): { links: GuestPostLink[], word_count: number }
export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient();

  // Parse optional body for link config
  let bodyLinks: GuestPostLink[] | undefined;
  let bodyWordCount: number | undefined;
  try {
    const body = await request.json();
    bodyLinks = body.links;
    bodyWordCount = body.word_count;
  } catch {
    // No body or invalid JSON — use defaults
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppRaw, error } = await (supabase as any)
    .from("seo_link_opportunities")
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

  // Build links array: use body links if provided, otherwise default to single target link
  const links: GuestPostLink[] = bodyLinks || [
    {
      url: opp.target_page,
      anchorText: opp.target_keyword,
      type: 'target',
    },
  ];

  // Validate at least 1 link
  if (links.length === 0 || links.length > 3) {
    return NextResponse.json({ error: "1 a 3 liens maximum" }, { status: 422 });
  }

  // Check existing anchor distribution from purchases
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchasesRaw } = await (supabase as any)
    .from("seo_link_purchases")
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
    const article = await generateGuestPostArticle({
      vendorDomain: opp.vendor_domain,
      vendorNiche: opp.niche,
      targetKeyword: opp.target_keyword,
      siteDomain: site?.domain || "",
      siteNiche: site?.niche || "generaliste",
      links,
      wordCount: bodyWordCount || 800,
      anchorProfile,
    });

    // Save to opportunity
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase as any)
      .from("seo_link_opportunities")
      .update({
        generated_article: article,
        anchor_suggestions: article.anchors,
        status: "article_generated",
      })
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

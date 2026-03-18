import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { analyzeGap } from "@/lib/netlinking/analyzer";

export const maxDuration = 60;

const gapSchema = z.object({
  site_id: z.string().uuid(),
});

// POST /api/netlinking/gap-analysis — Run AI gap analysis for a site
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = gapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  // Fetch latest profile for the site
  const { data: profile } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_profiles" as any)
    .select("*")
    .eq("site_id", parsed.data.site_id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  // Fetch site info
  const { data: site } = await supabase
    .from("seo_sites")
    .select("name, domain, niche")
    .eq("id", parsed.data.site_id)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site non trouve" }, { status: 404 });
  }

  try {
    const gap = await analyzeGap({
      siteDomain: site.domain,
      siteNiche: site.niche || "generaliste",
      tf: profile?.tf || 0,
      cf: profile?.cf || 0,
      da: profile?.da || 0,
      dr: profile?.dr || 0,
      referringDomains: profile?.referring_domains || 0,
      organicTraffic: profile?.organic_traffic || 0,
    });

    return NextResponse.json({
      site: site,
      profile: profile || null,
      gap_analysis: gap,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Erreur analyse : ${msg}` }, { status: 500 });
  }
}

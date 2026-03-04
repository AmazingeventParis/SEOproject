import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { getAllPublishedPosts } from "@/lib/wordpress/client";

interface RouteContext {
  params: { siteId: string };
}

// GET /api/sites/[siteId]/wp-posts — List WP posts not yet imported
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { siteId } = params;
  const supabase = getServerClient();

  try {
    // 1. Fetch all published WP posts
    const wpPosts = await getAllPublishedPosts(siteId);

    // 2. Fetch wp_post_ids already in seo_articles for this site
    const { data: existing } = await supabase
      .from("seo_articles")
      .select("wp_post_id")
      .eq("site_id", siteId)
      .not("wp_post_id", "is", null);

    const existingIds = new Set(
      existing?.map((a) => a.wp_post_id).filter(Boolean) || []
    );

    // 3. Filter out already imported posts
    const available = wpPosts.filter((p) => !existingIds.has(p.id));

    return NextResponse.json({
      total: wpPosts.length,
      alreadyImported: existingIds.size,
      available,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json(
      { error: `Impossible de recuperer les posts WP: ${message}` },
      { status: 500 }
    );
  }
}

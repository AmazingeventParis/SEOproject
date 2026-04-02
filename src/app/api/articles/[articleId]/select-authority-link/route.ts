import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import type { AuthorityLinkSuggestion, SelectedAuthorityLink } from "@/lib/supabase/types";

const selectSchema = z.object({
  link_index: z.number().int().min(0).optional(),
  custom_url: z.string().url().optional(),
  custom_title: z.string().optional(),
  anchor_context: z.string().optional(),
}).refine(
  (data) => data.link_index !== undefined || data.custom_url !== undefined,
  { message: "link_index ou custom_url requis" }
);

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/select-authority-link
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { link_index, custom_url, custom_title, anchor_context } = parsed.data;

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("authority_link_suggestions")
    .eq("id", params.articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  const suggestions = article.authority_link_suggestions as AuthorityLinkSuggestion[] | null;
  let selectedLink: SelectedAuthorityLink;
  let updatedSuggestions = suggestions || [];

  if (link_index !== undefined) {
    // Select from existing suggestions
    if (!suggestions || !suggestions[link_index]) {
      return NextResponse.json(
        { error: "Suggestion de lien introuvable" },
        { status: 400 }
      );
    }

    const chosen = suggestions[link_index];
    selectedLink = {
      url: chosen.url,
      title: chosen.title,
      anchor_context: anchor_context || chosen.rationale,
    };

    updatedSuggestions = suggestions.map((s, i) => ({
      ...s,
      selected: i === link_index,
    }));
  } else {
    // Custom URL
    const url = custom_url!;

    // HEAD-check the custom URL
    let isValid = false;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
        redirect: "follow",
      });
      isValid = res.status >= 200 && res.status < 400;
    } catch {
      // URL unreachable
    }

    if (!isValid) {
      return NextResponse.json(
        { error: "Le lien personnalise ne repond pas (HTTP error ou timeout)" },
        { status: 422 }
      );
    }

    selectedLink = {
      url,
      title: custom_title || url,
      anchor_context: anchor_context || "",
    };

    // Deselect all existing suggestions
    updatedSuggestions = (suggestions || []).map((s) => ({
      ...s,
      selected: false,
    }));
  }

  // Save
  const { data, error } = await supabase
    .from("seo_articles")
    .update({
      selected_authority_link: selectedLink,
      authority_link_suggestions: updatedSuggestions,
    })
    .eq("id", params.articleId)
    .select(
      "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { routeAI } from "@/lib/ai/router";
import { analyzeSERP } from "@/lib/seo/serper";
import type { AuthorityLinkSuggestion } from "@/lib/supabase/types";

interface RouteContext {
  params: { articleId: string };
}

const AUTHORITY_PATTERNS = [
  "wikipedia.org", "gouv.fr", "service-public.fr",
  ".edu", "who.int", "europa.eu", "legifrance.gouv.fr",
  "insee.fr", "has-sante.fr", "ademe.fr",
  "nature.com", "sciencedirect.com", "springer.com",
  "lemonde.fr", "lefigaro.fr",
];

function isAuthority(url: string): boolean {
  return AUTHORITY_PATTERNS.some((p) => url.includes(p));
}

// POST /api/articles/[articleId]/suggest-authority-links
// Regenerate authority link suggestions
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  // Fetch article
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, keyword, serp_data")
    .eq("id", params.articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  try {
    const serpDataRaw = article.serp_data as {
      serp?: { organic: { title: string; link: string; snippet?: string; domain?: string }[] }
    } | null;

    const organicResults = serpDataRaw?.serp?.organic || [];

    // 1. Filter authority domains from existing SERP
    let candidates = organicResults
      .filter((r) => r.link && isAuthority(r.link))
      .map((r) => ({
        url: r.link,
        title: r.title || "",
        domain: r.domain || new URL(r.link).hostname,
        snippet: r.snippet || "",
      }));

    // 2. Supplementary Serper query if < 2
    if (candidates.length < 2) {
      try {
        const suppSerp = await analyzeSERP(
          `"${article.keyword}" etude OR statistiques OR officiel`,
          { num: 10 }
        );
        const suppResults = (suppSerp?.organic || []) as {
          title: string; link: string; snippet?: string; domain?: string
        }[];
        const existingUrls = new Set(candidates.map((c) => c.url));
        const newCandidates = suppResults
          .filter((r) => r.link && isAuthority(r.link) && !existingUrls.has(r.link))
          .map((r) => ({
            url: r.link,
            title: r.title || "",
            domain: r.domain || new URL(r.link).hostname,
            snippet: r.snippet || "",
          }));
        candidates = [...candidates, ...newCandidates];
      } catch {
        // Supplementary SERP failed
      }
    }

    if (candidates.length === 0) {
      // No authority links found — save empty + reset
      const { data, error } = await supabase
        .from("seo_articles")
        .update({
          authority_link_suggestions: null,
          selected_authority_link: null,
        })
        .eq("id", params.articleId)
        .select(
          "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
        )
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }

    // 3. HEAD-check
    const validationResults = await Promise.allSettled(
      candidates.slice(0, 5).map(async (c) => {
        try {
          const res = await fetch(c.url, {
            method: "HEAD",
            signal: AbortSignal.timeout(5000),
            redirect: "follow",
          });
          return { ...c, is_valid: res.status >= 200 && res.status < 400 };
        } catch {
          return { ...c, is_valid: false };
        }
      })
    );
    const checkedCandidates = validationResults
      .filter(
        (r): r is PromiseFulfilledResult<typeof candidates[0] & { is_valid: boolean }> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value);

    // 4. Gemini Flash evaluation
    const evalPrompt = `Tu es un expert SEO. Voici des sources potentielles d'autorite pour un article sur "${article.keyword}".

Candidats :
${checkedCandidates.map((c, i) => `${i + 1}. ${c.title} (${c.domain}) — ${c.snippet.slice(0, 150)}`).join("\n")}

Selectionne les 2-3 meilleures sources pour renforcer l'E-E-A-T de l'article.
Pour chaque source selectionnee, fournis :
- rationale : pourquoi cette source renforce la credibilite (1 phrase)
- anchor_context : suggestion de phrase dans laquelle integrer le lien (1 phrase)

Retourne UNIQUEMENT un JSON valide :
{
  "selections": [
    { "index": 0, "rationale": "...", "anchor_context": "..." }
  ]
}
Pas de texte avant ou apres le JSON.`;

    const evalResponse = await routeAI("evaluate_authority_links", [
      { role: "user", content: evalPrompt },
    ]);
    const evalCleaned = evalResponse.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const evalParsed = JSON.parse(evalCleaned) as {
      selections: { index: number; rationale: string; anchor_context: string }[];
    };

    const suggestions: AuthorityLinkSuggestion[] = (evalParsed.selections || [])
      .filter((s) => checkedCandidates[s.index])
      .map((s) => ({
        url: checkedCandidates[s.index].url,
        title: checkedCandidates[s.index].title,
        domain: checkedCandidates[s.index].domain,
        snippet: checkedCandidates[s.index].snippet,
        rationale: s.rationale,
        is_valid: checkedCandidates[s.index].is_valid,
        selected: false,
      }));

    // Save + reset selected
    const { data, error } = await supabase
      .from("seo_articles")
      .update({
        authority_link_suggestions: suggestions.length > 0 ? suggestions : null,
        selected_authority_link: null,
      })
      .eq("id", params.articleId)
      .select(
        "*, seo_sites!seo_articles_site_id_fkey(name, domain, niche), seo_personas!seo_articles_persona_id_fkey(name, role, tone_description, bio)"
      )
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Erreur generation liens d'autorite: ${msg}` },
      { status: 500 }
    );
  }
}

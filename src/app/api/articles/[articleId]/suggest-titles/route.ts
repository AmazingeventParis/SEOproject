import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { routeAI } from "@/lib/ai/router";
import type { TitleSuggestion, ContentBlock } from "@/lib/supabase/types";

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/suggest-titles
// Regenerate title suggestions using the existing plan context (fast, via Gemini Flash)
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();

  // Fetch article with plan data
  const { data: article, error: fetchError } = await supabase
    .from("seo_articles")
    .select("id, keyword, search_intent, content_blocks, serp_data")
    .eq("id", params.articleId)
    .single();

  if (fetchError || !article) {
    return NextResponse.json(
      { error: "Article non trouve" },
      { status: 404 }
    );
  }

  const blocks = (article.content_blocks || []) as ContentBlock[];
  const h2Headings = blocks
    .filter((b) => b.type === "h2" && b.heading)
    .map((b) => b.heading)
    .join(", ");

  const serpDataRaw = article.serp_data as {
    serp?: { organic: { title: string }[] }
  } | null;

  const competitorTitles = serpDataRaw?.serp?.organic
    ?.slice(0, 5)
    .map((r) => r.title)
    .join("\n- ") || "";

  const prompt = `Tu es un expert SEO. Genere exactement 3 suggestions de titre H1 optimises pour le mot-cle "${article.keyword}" (intention: ${article.search_intent}).

Contexte de l'article :
- Sections H2 : ${h2Headings || "non definies"}
${competitorTitles ? `- Titres concurrents :\n- ${competitorTitles}` : ""}

Chaque titre doit suivre une strategie differente :
1. **Question** : formule comme une question (cible le featured snippet)
2. **Promesse** : valeur claire pour le lecteur
3. **Specifique** : chiffres, donnees concretes ou annee en cours (2026)

Retourne UNIQUEMENT un JSON valide :
{
  "title_suggestions": [
    { "title": "...", "slug": "...", "seo_rationale": "..." },
    { "title": "...", "slug": "...", "seo_rationale": "..." },
    { "title": "...", "slug": "...", "seo_rationale": "..." }
  ]
}

Regles :
- Titre : 50-65 caracteres ideal
- Slug : minuscules, sans accents, tirets
- seo_rationale : 1 phrase explicative
- Pas de texte avant ou apres le JSON`;

  try {
    const aiResponse = await routeAI(
      "generate_title",
      [{ role: "user", content: prompt }]
    );

    const cleaned = aiResponse.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      title_suggestions: { title: string; slug: string; seo_rationale: string }[];
    };

    const titleSuggestions: TitleSuggestion[] = (
      parsed.title_suggestions || []
    ).map((s) => ({
      title: s.title,
      slug: s.slug,
      seo_rationale: s.seo_rationale,
      selected: false,
    }));

    // Save new suggestions, reset title/slug
    const { data, error } = await supabase
      .from("seo_articles")
      .update({
        title: null,
        slug: null,
        title_suggestions: titleSuggestions,
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Erreur generation titres: ${msg}` },
      { status: 500 }
    );
  }
}

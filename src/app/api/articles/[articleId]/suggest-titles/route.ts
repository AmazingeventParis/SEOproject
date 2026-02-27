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

  const currentYear = new Date().getFullYear();

  const prompt = `Tu es un expert SEO. Genere exactement 3 suggestions de titre H1 optimises pour le mot-cle "${article.keyword}" (intention: ${article.search_intent}).

REGLE ABSOLUE — ANNEE : Nous sommes en ${currentYear}. Si un titre ou seo_title contient une annee, ce DOIT etre ${currentYear}. JAMAIS 2024, JAMAIS 2025. C'est non negociable.

Contexte de l'article :
- Sections H2 : ${h2Headings || "non definies"}
${competitorTitles ? `- Titres concurrents :\n- ${competitorTitles}` : ""}

Chaque titre doit suivre une strategie differente :
1. **Question** : formule comme une question (cible le featured snippet)
2. **Promesse** : valeur claire pour le lecteur
3. **Specifique** : chiffres, donnees concretes ou annee ${currentYear} (OBLIGATOIRE : l'annee doit etre ${currentYear})

Retourne UNIQUEMENT un JSON valide :
{
  "title_suggestions": [
    { "title": "...", "seo_title": "...", "slug": "...", "seo_rationale": "..." },
    { "title": "...", "seo_title": "...", "slug": "...", "seo_rationale": "..." },
    { "title": "... ${currentYear} ...", "seo_title": "... ${currentYear} ...", "slug": "slug-sans-annee", "seo_rationale": "..." }
  ]
}

Regles :
- title (H1) : 50-65 caracteres ideal, titre visible sur la page
- seo_title (balise <title>) : 50-60 caracteres, optimise CTR dans les SERP, peut differer du H1
- Slug : minuscules, sans accents, tirets, JAMAIS d'annee dans le slug (un slug est intemporel)
- seo_rationale : 1 phrase explicative
- TOUTE annee dans title/seo_title = ${currentYear}. Verifie avant de repondre.
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
      title_suggestions: { title: string; seo_title?: string; slug: string; seo_rationale: string }[];
    };

    // Fix wrong years in generated titles + strip years from slugs
    const fixYear = (text: string) => text.replace(/\b(202[0-9])\b/g, (match) => match === String(currentYear) ? match : String(currentYear));
    const stripYearFromSlug = (slug: string) => slug.replace(/[-]?(202[0-9])[-]?/g, '-').replace(/^-|-$/g, '').replace(/--+/g, '-');

    const titleSuggestions: TitleSuggestion[] = (
      parsed.title_suggestions || []
    ).map((s) => ({
      title: fixYear(s.title),
      seo_title: fixYear(s.seo_title || s.title),
      slug: stripYearFromSlug(s.slug),
      seo_rationale: s.seo_rationale,
      selected: false,
    }));

    // Save new suggestions, reset title/slug/seo_title
    const { data, error } = await supabase
      .from("seo_articles")
      .update({
        title: null,
        slug: null,
        seo_title: null,
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

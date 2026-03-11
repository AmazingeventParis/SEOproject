import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/client";
import { routeAI } from "@/lib/ai/router";

export const maxDuration = 60;

interface RouteContext {
  params: { articleId: string };
}

// POST /api/articles/[articleId]/optimize-ctr
// Generates optimized seo_title and meta_description variants for better CTR
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient();
  const { articleId } = params;

  try {
    // Fetch article with GSC data
    const { data: article, error } = await supabase
      .from("seo_articles")
      .select("id, keyword, title, seo_title, meta_description, serp_data, search_intent, content_blocks")
      .eq("id", articleId)
      .single();

    if (error || !article) {
      return NextResponse.json(
        { error: "Article non trouve" },
        { status: 404 }
      );
    }

    const serpData = (article.serp_data || {}) as Record<string, unknown>;
    const gscAnalysis = serpData.gsc_analysis as { metrics?: { avgPosition?: number; ctr?: number; clicks?: number; impressions?: number }; topQueries?: { query: string; clicks: number; impressions: number; ctr: number; position: number }[] } | undefined;

    // Extract current performance
    const avgPosition = gscAnalysis?.metrics?.avgPosition || 0;
    const currentCtr = gscAnalysis?.metrics?.ctr || 0;
    const topQueries = gscAnalysis?.topQueries || [];

    // Get article intro for context
    const contentBlocks = (article.content_blocks || []) as { type: string; heading?: string; content_html: string }[];
    const introText = contentBlocks
      .find(b => b.type === 'paragraph' && !b.heading)
      ?.content_html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) || '';

    // Build the prompt
    const prompt = `Tu es un expert SEO specialise dans l'optimisation du CTR (Click-Through Rate) sur Google.

## ARTICLE
- Mot-cle principal : "${article.keyword}"
- Titre actuel (H1) : "${article.title || article.keyword}"
- SEO Title actuel : "${article.seo_title || article.title || ''}"
- Meta description actuelle : "${article.meta_description || ''}"
- Intention de recherche : ${article.search_intent || 'informational'}
- Intro : ${introText}

## PERFORMANCE GSC
- Position moyenne : ${avgPosition.toFixed(1)}
- CTR actuel : ${(currentCtr * 100).toFixed(1)}%
- Top requetes recherchees :
${topQueries.slice(0, 10).map(q => `  - "${q.query}" (pos ${q.position.toFixed(0)}, CTR ${(q.ctr * 100).toFixed(1)}%)`).join('\n')}

## MISSION
Genere 3 variantes optimisees pour le SEO Title et la Meta Description.

Techniques a utiliser :
- Chiffres concrets (annee ${new Date().getFullYear()}, "Top 10", "5 etapes")
- Power words (Gratuit, Complet, Exclusif, Secret, Essentiel)
- Parentheses/crochets pour les qualificateurs [Guide ${new Date().getFullYear()}]
- Questions si l'intention est informationnelle
- Promesse de valeur claire
- Integrer les requetes les plus recherchees naturellement

Contraintes :
- SEO Title : 50-60 caracteres max (CRITIQUE - Google tronque apres 60)
- Meta Description : 140-155 caracteres (CRITIQUE)
- Le mot-cle principal "${article.keyword}" DOIT apparaitre dans chaque variante
- Pas de guillemets francais, pas de tirets cadratins
- Chaque variante doit etre DIFFERENTE en approche (pas juste reformulee)

Retourne UNIQUEMENT un JSON valide :
{
  "variants": [
    {
      "seo_title": "...",
      "meta_description": "...",
      "strategy": "chiffre + urgence"
    },
    {
      "seo_title": "...",
      "meta_description": "...",
      "strategy": "question + promesse"
    },
    {
      "seo_title": "...",
      "meta_description": "...",
      "strategy": "power word + specificite"
    }
  ]
}`;

    const response = await routeAI('generate_meta', [
      { role: 'user', content: prompt },
    ]);

    // Parse the response
    let parsed: { variants: { seo_title: string; meta_description: string; strategy: string }[] };
    try {
      const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      // Find first { and last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        parsed = JSON.parse(cleaned);
      }
    } catch {
      return NextResponse.json(
        { error: "Erreur de parsing de la reponse IA" },
        { status: 500 }
      );
    }

    if (!parsed.variants || !Array.isArray(parsed.variants)) {
      return NextResponse.json(
        { error: "Format de reponse invalide" },
        { status: 500 }
      );
    }

    // Store variants in serp_data
    await supabase
      .from("seo_articles")
      .update({
        serp_data: {
          ...serpData,
          ctr_variants: {
            generatedAt: new Date().toISOString(),
            currentSeoTitle: article.seo_title,
            currentMetaDescription: article.meta_description,
            avgPosition,
            currentCtr,
            variants: parsed.variants,
          },
        },
      })
      .eq("id", articleId);

    return NextResponse.json({
      success: true,
      variants: parsed.variants,
      currentPerformance: {
        avgPosition,
        ctr: currentCtr,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

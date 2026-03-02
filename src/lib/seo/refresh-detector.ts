import { getServerClient } from "@/lib/supabase/client";

interface StaleArticle {
  id: string;
  keyword: string;
  title: string | null;
  published_at: string;
  daysSincePublish: number;
  word_count: number;
}

/**
 * Detecte les articles publies depuis plus de 120 jours (~4 mois) pour un site donne.
 */
export async function detectStaleArticles(siteId: string): Promise<StaleArticle[]> {
  const supabase = getServerClient();

  const cutoffDays = 120; // 4 mois
  const cutoffDateObj = new Date();
  cutoffDateObj.setDate(cutoffDateObj.getDate() - cutoffDays);
  const cutoffDate = cutoffDateObj.toISOString();

  const { data, error } = await supabase
    .from("seo_articles")
    .select("id, keyword, title, published_at, word_count")
    .eq("site_id", siteId)
    .eq("status", "published")
    .lt("published_at", cutoffDate)
    .order("published_at", { ascending: true });

  if (error) {
    throw new Error("Erreur lors de la detection des articles obsoletes : " + error.message);
  }

  if (!data) {
    return [];
  }

  const now = Date.now();

  return data
    .filter((article): article is typeof article & { published_at: string } =>
      article.published_at !== null
    )
    .map((article) => ({
      id: article.id,
      keyword: article.keyword,
      title: article.title,
      published_at: article.published_at,
      word_count: article.word_count,
      daysSincePublish: Math.floor(
        (now - new Date(article.published_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));
}

/**
 * Retourne les candidats au rafraichissement, tries par anciennete (plus ancien en premier).
 * Inclut egalement les articles avec un word_count inferieur a 1000 comme signal supplementaire.
 */
export async function getRefreshCandidates(siteId: string): Promise<StaleArticle[]> {
  const staleArticles = await detectStaleArticles(siteId);

  // Trier par anciennete decroissante (les plus anciens en premier)
  // puis privilegier les articles avec un contenu court (< 1000 mots)
  return staleArticles.sort((a, b) => {
    // Les articles courts sont prioritaires
    const aShort = a.word_count < 1000 ? 1 : 0;
    const bShort = b.word_count < 1000 ? 1 : 0;
    if (aShort !== bShort) {
      return bShort - aShort;
    }
    // Ensuite trier par nombre de jours depuis publication (decroissant)
    return b.daysSincePublish - a.daysSincePublish;
  });
}

/**
 * Marque les articles donnes avec le statut 'refresh_needed'.
 * Retourne le nombre d'articles mis a jour.
 */
export async function markForRefresh(articleIds: string[]): Promise<number> {
  if (articleIds.length === 0) {
    return 0;
  }

  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("seo_articles")
    .update({ status: "refresh_needed" as const, updated_at: new Date().toISOString() })
    .in("id", articleIds)
    .select("id");

  if (error) {
    throw new Error("Erreur lors du marquage des articles pour rafraichissement : " + error.message);
  }

  return data?.length ?? 0;
}

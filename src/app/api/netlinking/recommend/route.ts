import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerClient } from "@/lib/supabase/client";
import { routeAI } from "@/lib/ai/router";

export const maxDuration = 60;

const schema = z.object({
  site_id: z.string().uuid(),
});

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Pas de JSON dans la reponse IA");
  return cleaned.slice(start, end + 1);
}

// POST /api/netlinking/recommend — AI recommendation for which link to buy and what content to create
export async function POST(request: NextRequest) {
  const supabase = getServerClient();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation echouee", details: parsed.error.format() }, { status: 422 });
  }

  const { site_id } = parsed.data;

  // 1. Fetch site info
  const { data: site } = await supabase
    .from("seo_sites")
    .select("name, domain, niche")
    .eq("id", site_id)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site non trouve" }, { status: 404 });
  }

  // 2. Fetch all opportunities for this site
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: oppsRaw } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_opportunities" as any)
    .select("*")
    .eq("site_id", site_id)
    .order("created_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities = (oppsRaw || []) as any[];

  if (opportunities.length === 0) {
    return NextResponse.json({ error: "Aucune opportunite ajoutee. Ajoutez d'abord des sites vendeurs." }, { status: 422 });
  }

  // 3. Fetch all published articles for this site (existing keywords)
  const { data: articles } = await supabase
    .from("seo_articles")
    .select("keyword, title, slug, wp_url, status")
    .eq("site_id", site_id);

  const existingKeywords = (articles || [])
    .filter((a: { status: string }) => ["published", "reviewing", "writing", "planned"].includes(a.status))
    .map((a: { keyword: string; title: string | null; wp_url: string | null }) => ({
      keyword: a.keyword,
      title: a.title || "",
      url: a.wp_url || "",
    }));

  // 4. Fetch existing purchases for anchor distribution
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: purchasesRaw } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_purchases" as any)
    .select("vendor_domain, anchor_type, anchor_text, target_page")
    .eq("site_id", site_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingPurchases = (purchasesRaw || []) as any[];

  // 5. Fetch link profile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRaw } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("seo_link_profiles" as any)
    .select("*")
    .eq("site_id", site_id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = profileRaw as any;

  // Build context for AI — enriched with Semrush data
  const oppsContext = opportunities.map((o) => {
    const vendorKws = (o.vendor_keywords || []) as { keyword: string; traffic: number; position: number; volume: number }[];
    const totalTrafficSemrush = vendorKws.reduce((s: number, k: { traffic: number }) => s + (k.traffic || 0), 0);
    const kwsTop10 = vendorKws.filter((k: { position: number }) => k.position <= 10).length;
    const kwsTop3 = vendorKws.filter((k: { position: number }) => k.position <= 3).length;
    const tfCfRatio = o.cf > 0 ? (o.tf / o.cf).toFixed(2) : "N/A";

    return {
      domain: o.vendor_domain,
      tf: o.tf,
      cf: o.cf,
      da: o.da,
      tf_cf_ratio: tfCfRatio,
      organic_traffic_declared: o.organic_traffic,
      price: o.price,
      price_per_tf: o.tf > 0 ? Math.round(o.price / o.tf) : "Infini",
      niche: o.niche || "non specifiee",
      target_keyword: o.target_keyword || null,
      target_page: o.target_page || null,
      semrush_data: {
        total_keywords: vendorKws.length,
        total_traffic_semrush: totalTrafficSemrush,
        keywords_top_3: kwsTop3,
        keywords_top_10: kwsTop10,
        top_keywords: vendorKws.slice(0, 15).map((k) =>
          `${k.keyword} (pos:${k.position}, vol:${k.volume || "?"}, trafic:${k.traffic})`
        ),
      },
    };
  });

  const existingKeywordsStr = existingKeywords.length > 0
    ? existingKeywords.map((k: { keyword: string; title: string }) => `- "${k.keyword}" (${k.title})`).join("\n")
    : "Aucun article publie";

  const purchasesStr = existingPurchases.length > 0
    ? existingPurchases.map((p: { vendor_domain: string; anchor_type: string; target_page: string }) =>
        `- ${p.vendor_domain} → ${p.target_page || "?"} (ancre: ${p.anchor_type || "?"})`).join("\n")
    : "Aucun achat precedent";

  const prompt = `Tu es un consultant SEO Senior expert en netlinking avec 15 ans d'experience. Tu dois evaluer la QUALITE REELLE de chaque site vendeur et recommander la meilleure strategie.

SITE CLIENT :
- Domaine : ${site.domain}
- Niche : ${site.niche || "generaliste"}
- TF : ${profile?.tf || "?"} | CF : ${profile?.cf || "?"} | DA : ${profile?.da || "?"}
- Trafic organique : ${profile?.organic_traffic || "?"}
- Domaines referents : ${profile?.referring_domains || "?"}

MOTS-CLES DEJA POSITIONNES (articles existants, NE PAS cibler ces mots-cles) :
${existingKeywordsStr}

ACHATS DE LIENS PRECEDENTS (eviter les doublons de pages cibles) :
${purchasesStr}

OPPORTUNITES DISPONIBLES (avec donnees Semrush) :
${JSON.stringify(oppsContext, null, 2)}

SCORING — Evalue chaque site vendeur selon ces criteres :
1. **Metriques SEO** : TF, CF, DA, ratio TF/CF (bon si > 0.5, suspect si < 0.3)
2. **Donnees Semrush** : nombre de mots-cles positionnes, trafic reel, keywords en top 3/10 (un site avec TF correct mais ZERO trafic Semrush = site potentiellement mort ou PBN)
3. **Rapport qualite/prix** : prix vs valeur reelle du lien (prix/TF, prix vs trafic)
4. **Pertinence thematique** : niche vendeur vs niche client
5. **Signaux de danger** : ratio TF/CF trop bas, pas de trafic organique, niche trop eloignee, prix excessif

LABELS OBLIGATOIRES — Attribue UN label par site :
- "pepite" (score >= 85) : excellent rapport qualite/prix, metriques solides, trafic reel, thematique alignee
- "super" (score 70-84) : tres bon site, quelques reserves mineures
- "correct" (score 55-69) : acceptable, bon pour diversifier le profil
- "moyen" (score 40-54) : peut servir mais pas prioritaire
- "a_eviter" (score < 40) : ne merite pas l'investissement (skip = true)

Un site avec skip=true est un site qu'il ne faut PAS acheter. Sois honnete et tranchant.

RECOMMANDATION pour chaque site NON skip :
- Type de contenu adapte au site vendeur
- Mot-cle cible DIFFERENT des mots-cles deja positionnes
- Page cible existante ou a creer
- Ancre recommandee

Reponds UNIQUEMENT en JSON valide :
{
  "ranking": [
    {
      "vendor_domain": "domaine.fr",
      "rank": 1,
      "score": 85,
      "label": "pepite / super / correct / moyen / a_eviter",
      "skip": false,
      "verdict": "Resume en 1 phrase",
      "justification": "Analyse detaillee : metriques, Semrush, rapport qualite/prix",
      "metrics_analysis": {
        "tf_cf_verdict": "Bon ratio / Ratio suspect / etc.",
        "semrush_verdict": "Trafic reel confirme / Site sans trafic / etc.",
        "price_verdict": "Excellent prix / Prix correct / Surpaye / etc."
      },
      "recommended_content": {
        "type": "article invite / guide / comparatif / etc.",
        "topic_suggestion": "Sujet precis",
        "target_keyword": "mot-cle (PAS un doublon)",
        "target_page": "URL existante ou 'a creer: /slug-suggere'",
        "anchor_type": "exact / broad / brand",
        "anchor_text_suggestion": "texte d'ancre suggere"
      },
      "risks": ["risque 1"]
    }
  ],
  "strategy": {
    "buy_order": ["domaine1.fr"],
    "skip_list": ["domaine-nul.fr"],
    "total_budget": 0,
    "expected_impact": "Description impact",
    "keywords_to_avoid": ["mot-cle deja positionne"],
    "missing_topics": ["sujet non couvert a cibler"]
  }
}`;

  try {
    const response = await routeAI("analyze_link_gap", [{ role: "user", content: prompt }]);
    const result = JSON.parse(extractJson(response.content));
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Erreur analyse IA : ${msg}` }, { status: 500 });
  }
}

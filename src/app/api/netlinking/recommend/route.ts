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

  // Build context for AI
  const oppsContext = opportunities.map((o) => ({
    domain: o.vendor_domain,
    tf: o.tf,
    cf: o.cf,
    da: o.da,
    traffic: o.organic_traffic,
    price: o.price,
    niche: o.niche || "non specifiee",
    target_keyword: o.target_keyword || null,
    target_page: o.target_page || null,
    vendor_keywords: (o.vendor_keywords || []).slice(0, 10).map((k: { keyword: string; traffic: number; position: number }) =>
      `${k.keyword} (pos:${k.position}, trafic:${k.traffic})`
    ),
  }));

  const existingKeywordsStr = existingKeywords.length > 0
    ? existingKeywords.map((k: { keyword: string; title: string }) => `- "${k.keyword}" (${k.title})`).join("\n")
    : "Aucun article publie";

  const purchasesStr = existingPurchases.length > 0
    ? existingPurchases.map((p: { vendor_domain: string; anchor_type: string; target_page: string }) =>
        `- ${p.vendor_domain} → ${p.target_page || "?"} (ancre: ${p.anchor_type || "?"})`).join("\n")
    : "Aucun achat precedent";

  const prompt = `Tu es un consultant SEO Senior expert en netlinking. Tu dois analyser les opportunites de liens et recommander la meilleure strategie.

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

OPPORTUNITES DISPONIBLES :
${JSON.stringify(oppsContext, null, 2)}

ANALYSE DEMANDEE :
1. **Classement** : Classe les opportunites de la meilleure a la pire avec justification
2. **Recommandation** : Pour chaque opportunite, recommande :
   - Le type de contenu a proposer au vendeur (article invité thematique, guide, comparatif, etc.)
   - Le mot-cle cible OPTIMAL (different des mots-cles deja positionnes !)
   - La page de ton site a linker (existante ou a creer)
   - Le type d'ancre recommande (exact, large, marque)
3. **Alertes** : Signale les risques (ratio TF/CF suspect, niche trop eloignee, prix excessif)
4. **Strategie globale** : Conseille sur l'ordre d'achat et le budget optimal

Reponds UNIQUEMENT en JSON valide :
{
  "ranking": [
    {
      "vendor_domain": "domaine.fr",
      "rank": 1,
      "score": 85,
      "verdict": "Excellent choix / Bon choix / A eviter / etc.",
      "justification": "Pourquoi ce classement",
      "recommended_content": {
        "type": "article invite / guide / comparatif / etc.",
        "topic_suggestion": "Sujet precis de l'article",
        "target_keyword": "mot-cle a cibler (PAS un doublon)",
        "target_page": "URL existante ou 'a creer: /slug-suggere'",
        "anchor_type": "exact / broad / brand",
        "anchor_text_suggestion": "texte d'ancre suggere"
      },
      "risks": ["risque 1", "risque 2"]
    }
  ],
  "strategy": {
    "buy_order": ["domaine1.fr", "domaine2.fr"],
    "total_budget": <number>,
    "expected_impact": "Description de l'impact attendu",
    "keywords_to_avoid": ["mot-cle deja positionne 1", "etc."],
    "missing_topics": ["sujet non couvert qui pourrait etre cible"]
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

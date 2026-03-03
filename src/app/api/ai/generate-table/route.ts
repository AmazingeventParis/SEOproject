import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

const schema = z.object({
  text: z.string().min(1, "Texte requis").max(5000),
});

const SYSTEM_PROMPT = `Tu es un expert en mise en forme de donnees. Ta mission : transformer du texte brut en un tableau HTML responsive, moderne et lisible.

## REGLES DE SORTIE
- Retourne UNIQUEMENT le HTML du tableau, rien d'autre (pas de markdown, pas d'explication)
- Structure OBLIGATOIRE :
  <div class="table-container">
    <table>
      <thead><tr><th>...</th></tr></thead>
      <tbody><tr><td>...</td></tr></tbody>
    </table>
  </div>

## REGLES DE CONTENU
- Analyse le texte pour identifier la meilleure structure en colonnes
- Si le texte contient des paires cle/valeur, fais 2 colonnes
- Si le texte est une liste d'elements avec proprietes, cree autant de colonnes que necessaire (max 5)
- Si le texte est une comparaison, cree un tableau comparatif avec les elements en colonnes
- Les en-tetes doivent etre courts et clairs (1-3 mots)
- Les cellules doivent etre concises
- Garde TOUTES les donnees du texte original, n'en supprime aucune
- Si une donnee ne rentre pas dans la structure, ajoute une colonne "Details" ou "Notes"

## STYLE
- Le CSS est gere automatiquement (.table-container applique shadow, border-radius, zebra-striping, hover)
- N'ajoute PAS de styles inline
- N'ajoute PAS de classes supplementaires`;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  try {
    const response = await routeAI(
      "generate_table",
      [{ role: "user", content: `Transforme ce texte en tableau HTML :\n\n${parsed.data.text}` }],
      SYSTEM_PROMPT
    );

    // Clean up: extract only the HTML part
    let html = response.content.trim();
    if (html.startsWith("```html")) html = html.slice(7);
    else if (html.startsWith("```")) html = html.slice(3);
    if (html.endsWith("```")) html = html.slice(0, -3);
    html = html.trim();

    return NextResponse.json({ html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Erreur generation : ${msg}` },
      { status: 500 }
    );
  }
}

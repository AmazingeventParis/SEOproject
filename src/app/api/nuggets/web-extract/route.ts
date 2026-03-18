import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { routeAI } from "@/lib/ai/router";

export const maxDuration = 120;

const webExtractSchema = z.object({
  content: z.string().min(50, "Le contenu doit faire au moins 50 caracteres"),
  url: z.string().url().optional(),
  topic: z.string().optional(),
});

const CONTENT_CHAR_LIMIT = 20_000;

const EXTRACT_PROMPT = (topic?: string) => `Tu es un expert en extraction de connaissances exclusives pour le SEO.

Extrais entre 3 et 15 "nuggets" (pepites de connaissance) de ce contenu web.

${topic ? `SUJET CIBLE : "${topic}". Concentre-toi UNIQUEMENT sur les informations pertinentes pour ce sujet.` : ""}

Chaque nugget doit etre :
- Un conseil actionnable, une donnee chiffree, une experience terrain, un insight unique, ou une technique specifique
- Redige en francais, clair et concis (1 a 3 phrases max)
- Autonome (comprehensible sans contexte supplementaire)
- EXCLUSIF : privilegier les informations rares, les chiffres precis, les retours d'experience, les comparatifs. Ignorer les banalites et le contenu generique.

Reponds UNIQUEMENT en JSON valide avec ce format :
{
  "nuggets": [
    { "content": "...", "tags": ["tag1", "tag2"] }
  ]
}

Les tags doivent etre des mots-cles courts en francais (1-2 mots max, tout en minuscules).
Ne mets PAS de commentaires ni de texte en dehors du JSON.`;

function extractJsonFromText(text: string): string {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("Pas de JSON trouve dans la reponse");

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") depth--;
    if (depth === 0) return cleaned.slice(start, i + 1);
  }

  let truncated = cleaned.slice(start);
  let inString = false;
  for (let i = 0; i < truncated.length; i++) {
    if (truncated[i] === "\\") { i++; continue; }
    if (truncated[i] === '"') inString = !inString;
  }
  if (inString) truncated += '"';

  const lastCompleteObj = truncated.lastIndexOf("}");
  if (lastCompleteObj > 0) {
    let repaired = truncated.slice(0, lastCompleteObj + 1);
    repaired = repaired.replace(/,\s*$/, "");
    repaired += "\n]\n}";
    return repaired;
  }

  return truncated;
}

// POST /api/nuggets/web-extract — Extract nuggets from web page content
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corps de requete invalide" },
      { status: 400 }
    );
  }

  const parsed = webExtractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  let { content } = parsed.data;
  const { url, topic } = parsed.data;

  if (content.length > CONTENT_CHAR_LIMIT) {
    content = content.slice(0, CONTENT_CHAR_LIMIT);
  }

  try {
    const prompt = EXTRACT_PROMPT(topic);
    const sourceInfo = url ? `\nSOURCE : ${url}` : "";

    const aiResponse = await routeAI(
      "extract_nuggets",
      [{ role: "user", content: `${prompt}${sourceInfo}\n\nCONTENU DE LA PAGE :\n${content}` }]
    );

    const jsonStr = extractJsonFromText(aiResponse.content);
    const result = JSON.parse(jsonStr);
    if (!Array.isArray(result.nuggets)) {
      throw new Error("Format invalide : nuggets n'est pas un tableau");
    }

    return NextResponse.json({
      nuggets: result.nuggets,
      url: url || null,
      content_length: content.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Erreur lors de l'extraction : ${msg}` },
      { status: 500 }
    );
  }
}

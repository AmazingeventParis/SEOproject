import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { YoutubeTranscript } from "youtube-transcript";
import { routeAI } from "@/lib/ai/router";

const youtubeImportSchema = z.object({
  url: z.string().url("URL invalide"),
});

const TRANSCRIPT_CHAR_LIMIT = 30_000;

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// POST /api/nuggets/youtube-import — Extract nuggets from a YouTube video transcript
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

  const parsed = youtubeImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation echouee", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { url } = parsed.data;
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "URL YouTube invalide. Formats acceptes : youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..." },
      { status: 400 }
    );
  }

  // 1. Fetch transcript
  let transcriptText: string;
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    transcriptText = segments.map((s) => s.text).join(" ");
    if (transcriptText.length > TRANSCRIPT_CHAR_LIMIT) {
      transcriptText = transcriptText.slice(0, TRANSCRIPT_CHAR_LIMIT);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Impossible de recuperer la transcription : ${msg}` },
      { status: 422 }
    );
  }

  if (!transcriptText || transcriptText.trim().length < 50) {
    return NextResponse.json(
      { error: "La transcription est trop courte ou vide. La video n'a peut-etre pas de sous-titres." },
      { status: 422 }
    );
  }

  // 2. Extract nuggets via Gemini
  const prompt = `Tu es un expert en extraction de connaissances. A partir de la transcription suivante d'une video YouTube, extrais entre 3 et 15 "nuggets" (pepites de connaissance).

Chaque nugget doit etre :
- Un conseil, une astuce, une donnee chiffree, une experience, ou un insight actionnable
- Redige en francais, clair et concis (1 a 3 phrases max)
- Autonome (comprehensible sans contexte supplementaire)

Reponds UNIQUEMENT en JSON valide avec ce format :
{
  "nuggets": [
    { "content": "...", "tags": ["tag1", "tag2"] }
  ]
}

Les tags doivent etre des mots-cles courts en francais (1-2 mots max, tout en minuscules).
Ne mets PAS de commentaires ni de texte en dehors du JSON.

TRANSCRIPTION :
${transcriptText}`;

  try {
    const aiResponse = await routeAI(
      "extract_nuggets",
      [{ role: "user", content: prompt }]
    );

    // Parse AI response
    let nuggets: { content: string; tags: string[] }[];
    try {
      const jsonStr = aiResponse.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      nuggets = parsed.nuggets;
      if (!Array.isArray(nuggets)) {
        throw new Error("Format invalide : nuggets n'est pas un tableau");
      }
    } catch (parseErr) {
      return NextResponse.json(
        { error: `Erreur de parsing de la reponse IA : ${parseErr instanceof Error ? parseErr.message : String(parseErr)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      nuggets,
      video_id: videoId,
      transcript_length: transcriptText.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Erreur lors de l'extraction IA : ${msg}` },
      { status: 500 }
    );
  }
}

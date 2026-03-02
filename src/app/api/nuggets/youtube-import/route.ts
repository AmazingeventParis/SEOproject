import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { YoutubeTranscript } from "youtube-transcript";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { routeAI } from "@/lib/ai/router";
import { getServerClient } from "@/lib/supabase/client";

const youtubeImportSchema = z.object({
  url: z.string().url("URL invalide"),
  transcript: z.string().optional(),
});

const TRANSCRIPT_CHAR_LIMIT = 30_000;
const LANGUAGES_TO_TRY = ["fr", "en", "es", "de", "pt", "it"];

const EXTRACT_PROMPT = `Tu es un expert en extraction de connaissances. Extrais entre 3 et 15 "nuggets" (pepites de connaissance) de ce contenu.

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
Ne mets PAS de commentaires ni de texte en dehors du JSON.`;

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

async function fetchTranscriptWithFallback(videoId: string): Promise<string | null> {
  for (const lang of LANGUAGES_TO_TRY) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      const text = segments.map((s) => s.text).join(" ");
      if (text.trim().length > 50) return text;
    } catch {
      // Try next language
    }
  }

  // Last attempt: no language specified
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map((s) => s.text).join(" ");
    if (text.trim().length > 50) return text;
  } catch {
    // Transcript not available
  }

  return null;
}

async function resolveGeminiKey(): Promise<string> {
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey) return envKey;

  try {
    const supabase = getServerClient();
    const { data, error } = await supabase
      .from("seo_config")
      .select("value")
      .eq("key", "gemini_api_key")
      .single();

    if (!error && data?.value) {
      const val = data.value as unknown;
      if (typeof val === "string" && val.length > 0) return val;
    }
  } catch {
    // fall through
  }

  throw new Error("Cle API Gemini non configuree.");
}

/**
 * Fallback: send YouTube URL directly to Gemini for video analysis.
 * Gemini 2.0 Flash can process YouTube videos natively via fileData.
 */
async function extractNuggetsFromVideo(videoUrl: string): Promise<{ content: string; tags: string[] }[]> {
  const apiKey = await resolveGeminiKey();
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.3,
    },
  });

  const result = await model.generateContent([
    {
      fileData: {
        fileUri: videoUrl,
        mimeType: "video/*",
      },
    },
    { text: EXTRACT_PROMPT },
  ]);

  const text = result.response.text();
  const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed.nuggets)) {
    throw new Error("Format invalide");
  }

  return parsed.nuggets;
}

function parseNuggetsFromAIResponse(content: string): { content: string; tags: string[] }[] {
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.nuggets)) {
    throw new Error("Format invalide : nuggets n'est pas un tableau");
  }
  return parsed.nuggets;
}

// POST /api/nuggets/youtube-import — Extract nuggets from a YouTube video
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

  const { url, transcript: manualTranscript } = parsed.data;
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json(
      { error: "URL YouTube invalide. Formats acceptes : youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..." },
      { status: 400 }
    );
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    let nuggets: { content: string; tags: string[] }[];
    let transcriptLength = 0;
    let method: string;

    if (manualTranscript && manualTranscript.trim().length >= 50) {
      // Method 1: Manual transcript provided by user
      let text = manualTranscript.trim();
      if (text.length > TRANSCRIPT_CHAR_LIMIT) text = text.slice(0, TRANSCRIPT_CHAR_LIMIT);
      transcriptLength = text.length;
      method = "manual";

      const aiResponse = await routeAI(
        "extract_nuggets",
        [{ role: "user", content: `${EXTRACT_PROMPT}\n\nTRANSCRIPTION :\n${text}` }]
      );
      nuggets = parseNuggetsFromAIResponse(aiResponse.content);
    } else {
      // Method 2: Try auto-transcript first
      const transcript = await fetchTranscriptWithFallback(videoId);

      if (transcript) {
        let text = transcript;
        if (text.length > TRANSCRIPT_CHAR_LIMIT) text = text.slice(0, TRANSCRIPT_CHAR_LIMIT);
        transcriptLength = text.length;
        method = "transcript";

        const aiResponse = await routeAI(
          "extract_nuggets",
          [{ role: "user", content: `${EXTRACT_PROMPT}\n\nTRANSCRIPTION :\n${text}` }]
        );
        nuggets = parseNuggetsFromAIResponse(aiResponse.content);
      } else {
        // Method 3: Gemini direct video analysis (no transcript needed)
        method = "video";
        nuggets = await extractNuggetsFromVideo(videoUrl);
      }
    }

    return NextResponse.json({
      nuggets,
      video_id: videoId,
      transcript_length: transcriptLength,
      method,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Erreur lors de l'extraction : ${msg}` },
      { status: 500 }
    );
  }
}

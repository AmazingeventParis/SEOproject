import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { YoutubeTranscript } from "youtube-transcript";
import { GoogleGenAI } from "@google/genai";
import { routeAI } from "@/lib/ai/router";
import { getServerClient } from "@/lib/supabase/client";

// Allow up to 180s for transcript fetch + AI extraction
export const maxDuration = 180;

const youtubeImportSchema = z.object({
  url: z.string().url("URL invalide"),
  transcript: z.string().optional(),
});

const TRANSCRIPT_CHAR_LIMIT = 15_000;
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

// ---- Transcript fetching: 3 methods for maximum reliability ----

/**
 * Method A: youtube-transcript library (works for most videos)
 */
async function fetchViaLibrary(videoId: string): Promise<string | null> {
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
    // Not available via library
  }
  return null;
}

/**
 * Method B: Direct YouTube innertube API (more reliable, bypasses library issues)
 * Fetches the video page HTML, extracts captions track URL, downloads captions XML
 */
async function fetchViaInnertube(videoId: string): Promise<string | null> {
  try {
    // Fetch video page to extract captions data
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    if (!pageRes.ok) return null;
    const pageHtml = await pageRes.text();

    // Extract captions data from ytInitialPlayerResponse
    const playerMatch = pageHtml.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});/);
    if (!playerMatch) return null;

    // Parse just enough to find captions — use regex to avoid parsing huge JSON
    const captionsSection = pageHtml.match(/"captionTracks"\s*:\s*(\[[\s\S]+?\])/);
    if (!captionsSection) return null;

    let captionTracks: { baseUrl: string; languageCode: string }[];
    try {
      captionTracks = JSON.parse(captionsSection[1]);
    } catch {
      return null;
    }

    if (!captionTracks || captionTracks.length === 0) return null;

    // Find best language track
    let track = captionTracks.find((t) => t.languageCode === "fr");
    if (!track) track = captionTracks.find((t) => t.languageCode?.startsWith("fr"));
    if (!track) track = captionTracks.find((t) => t.languageCode === "en");
    if (!track) track = captionTracks[0]; // Any available

    if (!track?.baseUrl) return null;

    // Fetch the captions XML
    const captionRes = await fetch(track.baseUrl);
    if (!captionRes.ok) return null;
    const captionXml = await captionRes.text();

    // Parse XML: extract text from <text> elements
    const textSegments: string[] = [];
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(captionXml)) !== null) {
      // Decode HTML entities
      const decoded = textMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/<[^>]*>/g, "") // strip any nested tags
        .trim();
      if (decoded) textSegments.push(decoded);
    }

    const text = textSegments.join(" ");
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Method C: YouTube oEmbed + innertube API with consent bypass
 * Some videos require cookie consent — this tries with a consent cookie
 */
async function fetchViaConsentBypass(videoId: string): Promise<string | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJmciADGgYIgJnZpwY",
      },
      redirect: "follow",
    });
    if (!pageRes.ok) return null;
    const pageHtml = await pageRes.text();

    // Try to extract captions from timedtext API URL in the page
    const timedTextMatch = pageHtml.match(/"baseUrl"\s*:\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/);
    if (!timedTextMatch) return null;

    const timedTextUrl = timedTextMatch[1].replace(/\\u0026/g, "&");

    const captionRes = await fetch(timedTextUrl);
    if (!captionRes.ok) return null;
    const captionXml = await captionRes.text();

    const textSegments: string[] = [];
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(captionXml)) !== null) {
      const decoded = textMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/<[^>]*>/g, "")
        .trim();
      if (decoded) textSegments.push(decoded);
    }

    const text = textSegments.join(" ");
    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Add timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Master transcript fetcher: runs all 3 methods in parallel, returns first success
 */
async function fetchTranscriptWithFallback(videoId: string): Promise<string | null> {
  // Run all 3 methods in parallel with individual 30s timeouts
  const results = await Promise.allSettled([
    withTimeout(fetchViaLibrary(videoId), 30_000),
    withTimeout(fetchViaInnertube(videoId), 30_000),
    withTimeout(fetchViaConsentBypass(videoId), 30_000),
  ]);

  // Return first non-null result
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }

  return null;
}

// ---- Gemini video fallback (free tier) when no transcript available ----

async function resolveGeminiKey(): Promise<string> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const supabase = getServerClient();
    const { data, error } = await supabase
      .from("seo_config").select("value").eq("key", "gemini_api_key").single();
    if (!error && data?.value && typeof data.value === "string") return data.value;
  } catch { /* fall through */ }
  throw new Error("Cle API Gemini non configuree.");
}

async function extractNuggetsFromVideo(
  videoUrl: string,
): Promise<{ content: string; tags: string[] }[]> {
  const apiKey = await resolveGeminiKey();
  const client = new GoogleGenAI({ apiKey });

  const result = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { fileData: { fileUri: videoUrl, mimeType: "video/*" } },
      { text: EXTRACT_PROMPT },
    ],
    config: { maxOutputTokens: 8192, temperature: 0.3 },
  });

  const text = result.text ?? "";
  const jsonStr = extractJsonFromText(text);
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.nuggets)) throw new Error("Format invalide");
  return parsed.nuggets;
}

function extractJsonFromText(text: string): string {
  // Remove markdown code fences
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Find the first { and its matching closing }
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("Pas de JSON trouve dans la reponse");

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") depth--;
    if (depth === 0) return cleaned.slice(start, i + 1);
  }

  // JSON was truncated — attempt repair
  let truncated = cleaned.slice(start);
  let inString = false;
  for (let i = 0; i < truncated.length; i++) {
    if (truncated[i] === '\\') { i++; continue; }
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

function parseNuggetsFromAIResponse(content: string): { content: string; tags: string[] }[] {
  const jsonStr = extractJsonFromText(content);
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
      // Method 2: Try auto-transcript (3 methods: library → innertube → consent bypass)
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
        // Method 3: No transcript — fallback to Gemini direct video analysis (free)
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        try {
          method = "video";
          nuggets = await extractNuggetsFromVideo(videoUrl);
        } catch (videoErr) {
          const videoMsg = videoErr instanceof Error ? videoErr.message : String(videoErr);
          if (videoMsg.includes("token count exceeds") || videoMsg.includes("1048576")) {
            throw new Error(
              "La video est trop longue pour etre analysee directement. " +
              "Copiez la transcription depuis YouTube (bouton \"...\" → \"Afficher la transcription\") " +
              "et collez-la dans le champ prevu."
            );
          }
          throw new Error(
            "Aucune transcription automatique disponible et l'analyse video a echoue (" +
            videoMsg.slice(0, 100) + "). " +
            "Copiez la transcription depuis YouTube (bouton \"...\" → \"Afficher la transcription\") " +
            "et collez-la dans le champ prevu."
          );
        }
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

import { fal } from "@fal-ai/client";
import { getServerClient } from "@/lib/supabase/client";

// Configure fal.ai API key from env var or seo_config
async function ensureFalKey(): Promise<void> {
  if (process.env.FAL_KEY) return;

  try {
    const supabase = getServerClient();
    const { data, error } = await supabase
      .from("seo_config")
      .select("value")
      .eq("key", "fal_api_key")
      .single();

    if (!error && data?.value && typeof data.value === "string") {
      process.env.FAL_KEY = data.value;
    }
  } catch {
    // fall through
  }
}

interface GenerateImageResult {
  url: string;
  width: number;
  height: number;
}

interface GenerateImageOptions {
  width?: number;
  height?: number;
  aspectRatio?: string;
}

interface Flux2ProOutput {
  images: { url: string; width: number; height: number; content_type?: string }[];
}

// ---- Anti-text & realism directives (appended to every prompt) ----
const REALISM_SUFFIX = [
  "Ultra realistic photograph taken with a Canon EOS R5, 35mm lens, f/2.8 aperture.",
  "Natural ambient lighting, shallow depth of field, authentic colors.",
  "ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO CAPTIONS, NO WATERMARKS, NO LOGOS anywhere in the image.",
  "No overlaid graphics, no UI elements, no infographics, no diagrams.",
  "Real-world scene, candid feel, editorial photography for a premium magazine.",
].join(" ");

/**
 * Generate an image using Flux 2 Pro via fal.ai.
 * Produces ultra-realistic editorial photos with NO text.
 */
export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions
): Promise<GenerateImageResult> {
  type ImageSize = "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";

  const sizeMap: Record<string, ImageSize> = {
    "1:1": "square",
    "4:3": "landscape_4_3",
    "16:9": "landscape_16_9",
    "3:4": "portrait_4_3",
    "9:16": "portrait_16_9",
  };
  const imageSize: ImageSize = sizeMap[options?.aspectRatio ?? "16:9"] || "landscape_16_9";

  const fullPrompt = `${prompt}. ${REALISM_SUFFIX}`;

  await ensureFalKey();

  try {
    const result = await fal.subscribe("fal-ai/flux-2-pro", {
      input: {
        prompt: fullPrompt,
        image_size: imageSize,
        output_format: "jpeg" as const,
        safety_tolerance: "5" as const,
      },
    });

    const data = result.data as Flux2ProOutput;
    const image = data.images[0];

    if (!image?.url) {
      throw new Error("Aucune image retournee par le modele");
    }

    return {
      url: image.url,
      width: image.width ?? (options?.width || 1200),
      height: image.height ?? (options?.height || 675),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Erreur lors de la generation d'image : ${error.message}`
      );
    }
    throw new Error("Erreur inconnue lors de la generation d'image");
  }
}

// ---- Intelligent prompt builder ----

/**
 * Strip HTML tags and truncate to a max length.
 */
function extractPlainText(html: string, maxLen = 300): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Build a rich, contextual image prompt from the actual block content.
 *
 * Strategy:
 * 1. Extract the real text of the section to understand the SUBJECT
 * 2. Identify concrete visual elements (people, objects, places, actions)
 * 3. Build a scene description that matches the editorial tone
 *
 * @param keyword      Article's target keyword
 * @param heading      H2/H3 heading of the section
 * @param contentHtml  The actual written HTML content of the block (or nearby blocks)
 * @param imageHint    Optional prompt hint from the plan
 * @param articleTitle Article title for overall context
 */
export function buildImagePrompt(
  keyword: string,
  heading: string,
  contentHtml?: string,
  imageHint?: string,
  articleTitle?: string,
): string {
  const parts: string[] = [];

  // Core subject: what the section is about
  parts.push(`Editorial photograph for a section about "${heading || keyword}".`);

  // Rich context from the actual written content
  if (contentHtml) {
    const text = extractPlainText(contentHtml, 400);
    if (text.length > 30) {
      parts.push(`The section discusses: ${text}`);
      parts.push(`Illustrate the main idea of this text with a concrete, real-world visual scene.`);
    }
  }

  // Use the plan's image hint if available (specific visual direction)
  if (imageHint) {
    parts.push(`Visual direction: ${imageHint}.`);
  }

  // Article-level context
  if (articleTitle) {
    parts.push(`This is part of an article titled "${articleTitle}".`);
  }

  // Scene construction directives
  parts.push(
    "Create a visually compelling scene that a reader would immediately associate with this topic.",
    "Focus on ONE clear subject or situation — avoid abstract or generic compositions.",
    "Use real people, objects, or environments relevant to the subject matter.",
    "Photojournalistic style, natural and authentic — not staged or stock-photo looking.",
    "No text, no overlay, no graphic elements, no watermarks.",
  );

  return parts.join(' ');
}

/**
 * Convenience function: builds a prompt and generates a 16:9 hero image.
 */
export async function generateHeroImage(
  keyword: string,
  articleTitle: string
): Promise<GenerateImageResult> {
  const prompt = [
    `Wide-angle editorial cover photograph for a premium article about "${keyword}".`,
    `Article title: "${articleTitle}".`,
    `Cinematic composition with a clear focal point that captures the essence of "${keyword}".`,
    `Real environment, authentic atmosphere, golden hour or dramatic natural lighting.`,
    `Hero banner format — the image should feel like the opening shot of a documentary.`,
    `No text, no overlay, no graphic elements, no watermarks.`,
  ].join(' ');

  return generateImage(prompt, {
    aspectRatio: "16:9",
  });
}

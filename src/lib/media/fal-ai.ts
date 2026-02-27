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

interface FluxProUltraOutput {
  images: { url: string; width: number; height: number; content_type: string }[];
  timings: Record<string, number>;
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
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
 * Generate an image using Flux Pro v1.1 Ultra via fal.ai.
 * Produces ultra-realistic editorial photos with NO text.
 */
export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions
): Promise<GenerateImageResult> {
  const aspectRatio = options?.aspectRatio ?? "16:9";

  const fullPrompt = `${prompt}. ${REALISM_SUFFIX}`;

  await ensureFalKey();

  try {
    const result = await fal.subscribe("fal-ai/flux-pro/v1.1-ultra", {
      input: {
        prompt: fullPrompt,
        aspect_ratio: aspectRatio,
        safety_tolerance: "5" as const,
        output_format: "jpeg",
      },
    });

    const data = result.data as FluxProUltraOutput;
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

/**
 * Build a descriptive image prompt in English for Flux Pro Ultra.
 * Focuses on concrete visual scenes — never asks for text or graphics.
 */
export function buildImagePrompt(
  keyword: string,
  blockContext: string,
  articleTitle: string
): string {
  return `Editorial photograph illustrating the concept of "${keyword}". Scene context: ${blockContext}. For an article titled "${articleTitle}". Show a real-world scene with authentic people or objects, natural environment, candid moment. No staged or stock-photo feel. No text or overlay of any kind.`;
}

/**
 * Convenience function: builds a prompt and generates a 16:9 hero image.
 */
export async function generateHeroImage(
  keyword: string,
  articleTitle: string
): Promise<GenerateImageResult> {
  const prompt = `Wide-angle editorial cover photo for a premium article about "${keyword}". Title: "${articleTitle}". Cinematic composition, golden hour lighting, real environment, authentic atmosphere. Hero banner format. No text, no overlay, no graphic elements.`;

  return generateImage(prompt, {
    aspectRatio: "16:9",
  });
}

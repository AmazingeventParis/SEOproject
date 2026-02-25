import { fal } from "@fal-ai/client";

// The fal client reads FAL_KEY from process.env automatically

interface GenerateImageResult {
  url: string;
  width: number;
  height: number;
}

interface GenerateImageOptions {
  width?: number;
  height?: number;
  style?: string;
}

interface FluxImage {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

interface FluxOutput {
  images: FluxImage[];
  timings: Record<string, number>;
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
}

/**
 * Generate an image using fal.ai's Flux Schnell model.
 * Default size is 1200x630 (blog hero format).
 */
export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions
): Promise<GenerateImageResult> {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 630;

  const fullPrompt = options?.style
    ? `${prompt}. Style: ${options.style}`
    : prompt;

  try {
    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt: fullPrompt,
        image_size: { width, height },
      },
    });

    const data = result.data as FluxOutput;
    const image = data.images[0];

    if (!image?.url) {
      throw new Error("Aucune image retournee par le modele");
    }

    return {
      url: image.url,
      width: image.width ?? width,
      height: image.height ?? height,
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
 * Build a descriptive image prompt in English for better AI results.
 */
export function buildImagePrompt(
  keyword: string,
  blockContext: string,
  articleTitle: string
): string {
  return `Professional blog illustration for article about ${keyword}. Context: ${blockContext}. Article title: ${articleTitle}. Style: modern, clean, editorial photography style, high quality`;
}

/**
 * Convenience function: builds a prompt and generates a 1200x630 hero image.
 */
export async function generateHeroImage(
  keyword: string,
  articleTitle: string
): Promise<GenerateImageResult> {
  const prompt = buildImagePrompt(
    keyword,
    "Hero image for the article",
    articleTitle
  );

  return generateImage(prompt, {
    width: 1200,
    height: 630,
    style: "professional, vibrant, editorial",
  });
}

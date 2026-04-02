import sharp from "sharp";

interface OptimizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
}

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

/**
 * Optimize an image for web delivery.
 * Resizes to max 1200px wide (maintaining aspect ratio) and converts to WebP.
 */
export async function optimizeForWeb(input: Buffer): Promise<OptimizedImage> {
  const optimized = await sharp(input)
    .resize({
      width: 1200,
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: optimized.data,
    width: optimized.info.width,
    height: optimized.info.height,
    size: optimized.info.size,
  };
}

/**
 * Extract image metadata: dimensions, format, and size.
 */
export async function getImageMetadata(
  input: Buffer
): Promise<ImageMetadata> {
  const metadata = await sharp(input).metadata();

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? "unknown",
    size: input.byteLength,
  };
}

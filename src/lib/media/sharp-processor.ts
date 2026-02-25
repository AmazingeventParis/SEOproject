import sharp from "sharp";

interface OptimizedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
}

interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
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
 * Generate a thumbnail at 400x300 in WebP format.
 */
export async function generateThumbnail(
  input: Buffer
): Promise<ThumbnailResult> {
  const thumbnail = await sharp(input)
    .resize({
      width: 400,
      height: 300,
      fit: "cover",
    })
    .webp({ quality: 75 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: thumbnail.data,
    width: thumbnail.info.width,
    height: thumbnail.info.height,
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

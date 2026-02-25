const MAX_FILENAME_LENGTH = 60;
const MAX_ALT_LENGTH = 125;

/**
 * Sanitize a text string into a URL/filename-safe slug.
 * Lowercases, removes accents, replaces special chars with hyphens.
 */
export function sanitizeFilename(text: string): string {
  return (
    text
      // Lowercase
      .toLowerCase()
      // Remove accents (normalize NFD then strip diacritical marks)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Replace spaces and special characters with hyphens
      .replace(/[^a-z0-9]+/g, "-")
      // Remove consecutive hyphens
      .replace(/-{2,}/g, "-")
      // Trim hyphens from start and end
      .replace(/^-+|-+$/g, "")
      // Truncate to max length
      .slice(0, MAX_FILENAME_LENGTH)
      // Trim any trailing hyphen after truncation
      .replace(/-+$/, "")
  );
}

/**
 * Generate an SEO-friendly filename for an image.
 * Format: {sanitized-keyword}-{sanitized-descriptor}-{index}.webp
 * Example: "meilleur-aspirateur-robot-hero-1.webp"
 */
export function generateSeoFilename(
  keyword: string,
  descriptor: string,
  index: number
): string {
  const sanitizedKeyword = sanitizeFilename(keyword);
  const sanitizedDescriptor = sanitizeFilename(descriptor);
  const baseName = `${sanitizedKeyword}-${sanitizedDescriptor}-${index}`;

  // Ensure the base name (without extension) fits within the limit
  const truncated = baseName.slice(0, MAX_FILENAME_LENGTH).replace(/-+$/, "");

  return `${truncated}.webp`;
}

/**
 * Generate descriptive French alt text for an image.
 * Rules:
 * - If heading is provided: "{heading} - {keyword}"
 * - If blockType is "hero": "Image principale : {keyword}"
 * - Otherwise: "Illustration {keyword}"
 * Max 125 characters.
 */
export function generateAltText(
  keyword: string,
  heading: string | null,
  blockType: string
): string {
  let alt: string;

  if (heading) {
    alt = `${heading} - ${keyword}`;
  } else if (blockType === "hero") {
    alt = `Image principale : ${keyword}`;
  } else {
    alt = `Illustration ${keyword}`;
  }

  // Truncate to max length, cutting at the last space if needed
  if (alt.length > MAX_ALT_LENGTH) {
    const truncated = alt.slice(0, MAX_ALT_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > MAX_ALT_LENGTH * 0.5) {
      return truncated.slice(0, lastSpace);
    }
    return truncated;
  }

  return alt;
}

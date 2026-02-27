const MAX_FILENAME_LENGTH = 50;
const MAX_ALT_LENGTH = 125;

/**
 * Sanitize a text string into a URL/filename-safe slug.
 * Lowercases, removes accents, replaces special chars with hyphens.
 */
export function sanitizeFilename(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_FILENAME_LENGTH)
      .replace(/-+$/, "")
  );
}

/**
 * Extract 2-3 meaningful words from a heading for a concise filename suffix.
 * Removes stop words and keeps the most descriptive terms.
 */
function extractKeyTerms(text: string, maxWords = 3): string {
  const stopWords = new Set([
    "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux",
    "et", "ou", "en", "pour", "par", "sur", "avec", "sans", "dans",
    "ce", "ces", "cette", "son", "sa", "ses", "mon", "ma", "mes",
    "qui", "que", "quoi", "dont", "comment", "pourquoi", "quel", "quelle",
    "est", "sont", "a", "the", "and", "or", "for", "how", "what", "your",
    "notre", "votre", "nos", "vos", "leur", "leurs", "tout", "tous",
    "plus", "pas", "ne", "se", "il", "elle", "ils", "elles", "on",
    "bien", "tres", "aussi", "meme", "entre", "avant", "apres",
  ]);

  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  return words.slice(0, maxWords).join("-");
}

/**
 * Generate an SEO-friendly filename for an image.
 *
 * Strategy:
 * - Hero: {keyword-short}.webp
 * - Section: {keyword-short}-{heading-terms}.webp
 * - Max ~50 chars before extension, concise and descriptive
 */
export function generateSeoFilename(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section"
): string {
  const keywordSlug = sanitizeFilename(keyword).slice(0, 30).replace(/-+$/, "");

  if (imageType === "hero") {
    return `${keywordSlug}.webp`;
  }

  // Section image: add heading key terms
  const headingTerms = heading ? extractKeyTerms(heading) : "";
  if (!headingTerms) {
    return `${keywordSlug}.webp`;
  }

  const baseName = `${keywordSlug}-${headingTerms}`;
  const truncated = baseName.slice(0, MAX_FILENAME_LENGTH).replace(/-+$/, "");
  return `${truncated}.webp`;
}

/**
 * Generate descriptive alt text for an image.
 *
 * Strategy:
 * - Uses the image_prompt_hint (scene description) when available
 * - Falls back to heading + keyword
 * - Always includes the keyword naturally
 * - Describes the visual scene, not just the topic
 * - Max 125 characters
 */
export function generateAltText(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section",
  imagePromptHint?: string | null
): string {
  let alt: string;

  if (imagePromptHint) {
    // Use the scene description from the plan, ensure keyword is present
    const hint = imagePromptHint
      .replace(/^editorial photo(graph)?\s*(showing|of|illustrating)?\s*/i, "")
      .replace(/\.$/, "");
    const keywordLower = keyword.toLowerCase();
    const hintLower = hint.toLowerCase();

    if (hintLower.includes(keywordLower) || hintLower.includes(keywordLower.split(" ")[0])) {
      alt = capitalize(hint);
    } else {
      alt = `${capitalize(hint)} - ${keyword}`;
    }
  } else if (heading && imageType === "section") {
    alt = `${heading} : photo illustrant ${keyword.toLowerCase()}`;
  } else {
    alt = `Photo illustrant ${keyword.toLowerCase()}`;
  }

  // Truncate at last space within limit
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

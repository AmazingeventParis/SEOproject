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
 * Generate descriptive alt text for an image — describes the VISIBLE scene.
 *
 * Strategy:
 * - imagePromptHint is IGNORED (it's an English prompt for Fal.ai, not a description)
 * - Alt text is built from the heading context in clean French
 * - Describes what a person would SEE in the image, not keywords
 * - Max 125 characters
 *
 * Google recommends alt text that describes the image content, not keyword stuffing.
 * A good alt text helps visually impaired users understand what the image shows.
 */
export function generateAltText(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section",
  _imagePromptHint?: string | null,
  sectionIndex?: number
): string {
  void _imagePromptHint; // intentionally ignored — English AI prompt, not a visual description

  if (imageType === "hero") {
    // Hero: simple descriptive alt based on keyword
    return truncateAlt(`Photo illustrant ${keyword.toLowerCase()}`);
  }

  if (heading) {
    // Section image: describe the visual scene based on heading topic
    const cleanHeading = heading
      .replace(/[?!.:…]+$/g, "")
      .replace(/^\d+[\s.):-]+/, "") // remove leading numbers "3. " "4) "
      .trim();

    // Vary the alt text pattern based on section index to avoid repetition
    const idx = sectionIndex ?? 0;
    const patterns = [
      (h: string) => `${h}`,
      (h: string) => `Illustration : ${h.toLowerCase()}`,
      (h: string) => `Photo representant ${h.toLowerCase()}`,
      (h: string) => `Vue detaillee : ${h.toLowerCase()}`,
      (h: string) => `${h} en image`,
    ];
    const pattern = patterns[idx % patterns.length];
    return truncateAlt(pattern(cleanHeading));
  }

  return truncateAlt(`Illustration complementaire sur ${keyword.toLowerCase()}`);
}

/** Truncate alt text at the last space within the 125-char limit */
function truncateAlt(alt: string): string {
  if (alt.length <= MAX_ALT_LENGTH) return alt;
  const truncated = alt.slice(0, MAX_ALT_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > MAX_ALT_LENGTH * 0.5) {
    return truncated.slice(0, lastSpace);
  }
  return truncated;
}

/**
 * Generate a title attribute for an image (tooltip on hover).
 * Different from alt: title provides additional context, not a description.
 * Helps with accessibility and gives a small SEO signal.
 */
export function generateImageTitle(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section"
): string {
  if (imageType === "hero") {
    return capitalize(keyword)
  }
  if (heading) {
    return `${capitalize(heading)} - ${capitalize(keyword)}`
  }
  return capitalize(keyword)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

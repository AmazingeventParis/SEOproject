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
 * French alt text templates indexed by image position/context.
 * Each template includes the keyword naturally for SEO.
 * Variety avoids repetitive alt patterns across an article.
 */
const ALT_HERO_TEMPLATES = [
  (kw: string) => `Illustration principale sur ${kw}`,
  (kw: string) => `Guide complet : ${kw}`,
  (kw: string) => `Tout savoir sur ${kw}`,
];

const ALT_SECTION_TEMPLATES = [
  (kw: string, h: string) => `${h} en rapport avec ${kw}`,
  (kw: string, h: string) => `${h} : conseils sur ${kw}`,
  (kw: string, h: string) => `${h} pour mieux comprendre ${kw}`,
  (kw: string, h: string) => `${h} et ${kw} expliques en detail`,
  (kw: string, h: string) => `Illustration de ${h.toLowerCase()} dans le contexte de ${kw}`,
];

const ALT_SECTION_NO_HEADING_TEMPLATES = [
  (kw: string) => `Illustration detaillee sur ${kw}`,
  (kw: string) => `Exemple concret en lien avec ${kw}`,
  (kw: string) => `Visuel explicatif sur ${kw}`,
];

/**
 * Generate descriptive alt text for an image — always in French, SEO-optimized.
 *
 * Strategy:
 * - Always in French (image_prompt_hint is English for the AI image generator, never used in alt)
 * - Includes the keyword naturally for SEO
 * - Uses heading context for section images
 * - Varied templates to avoid repetitive patterns
 * - Max 125 characters
 */
export function generateAltText(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section",
  imagePromptHint?: string | null,
  sectionIndex?: number
): string {
  const kw = keyword.toLowerCase();
  let alt: string;

  if (imageType === "hero") {
    const idx = (sectionIndex || 0) % ALT_HERO_TEMPLATES.length;
    alt = ALT_HERO_TEMPLATES[idx](kw);
  } else if (heading) {
    // Clean heading: remove trailing punctuation and normalize
    const cleanHeading = heading.replace(/[?!.:]+$/, "").trim();
    const idx = (sectionIndex || 0) % ALT_SECTION_TEMPLATES.length;
    // If heading already contains the keyword, use a simpler format
    if (cleanHeading.toLowerCase().includes(kw)) {
      alt = `${capitalize(cleanHeading)} : illustration et conseils`;
    } else {
      alt = ALT_SECTION_TEMPLATES[idx](kw, capitalize(cleanHeading));
    }
  } else {
    const idx = (sectionIndex || 0) % ALT_SECTION_NO_HEADING_TEMPLATES.length;
    alt = ALT_SECTION_NO_HEADING_TEMPLATES[idx](kw);
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

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
 * Translate an English image prompt hint to a natural French alt description.
 * Maps common English image description terms to French equivalents.
 */
function translatePromptToFrenchAlt(promptHint: string): string {
  let text = promptHint
    .toLowerCase()
    // Common English → French translations for image descriptions
    .replace(/\beditorial photo (of |showing )?/gi, "photo de ")
    .replace(/\bphotograph (of |showing )?/gi, "photo de ")
    .replace(/\bclose-up (of |on )?/gi, "gros plan sur ")
    .replace(/\baerial view (of )?/gi, "vue aerienne de ")
    .replace(/\boverhead (view |shot )?(of )?/gi, "vue de dessus de ")
    .replace(/\bwide shot (of )?/gi, "plan large de ")
    .replace(/\bperson /gi, "personne ")
    .replace(/\bpeople /gi, "personnes ")
    .replace(/\bwoman /gi, "femme ")
    .replace(/\bman /gi, "homme ")
    .replace(/\bhome /gi, "maison ")
    .replace(/\bhouse /gi, "maison ")
    .replace(/\bgarden /gi, "jardin ")
    .replace(/\bkitchen /gi, "cuisine ")
    .replace(/\bbathroom /gi, "salle de bain ")
    .replace(/\bworker /gi, "artisan ")
    .replace(/\binstalling /gi, "installant ")
    .replace(/\bmodern /gi, "moderne ")
    .replace(/\bnatural light/gi, "lumiere naturelle")
    .replace(/\bcozy /gi, "chaleureux ")
    .replace(/\bcomparison /gi, "comparaison ")
    .replace(/\bbefore and after/gi, "avant et apres")
    .replace(/\bstep[- ]by[- ]step/gi, "etape par etape")
    .replace(/\btools /gi, "outils ")
    .replace(/\bwith /gi, "avec ")
    .replace(/\band /gi, "et ")
    .replace(/\bin a /gi, "dans un ")
    .replace(/\bon a /gi, "sur un ")
    .trim()

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1)

  return text
}

/**
 * Generate descriptive alt text for an image — describes what's IN the image.
 *
 * Strategy:
 * - PRIORITY 1: Use imagePromptHint (translated to French) — it describes the actual scene
 * - PRIORITY 2: Use heading context as fallback
 * - Keyword is NOT force-injected — only included if it naturally fits the description
 * - Max 125 characters
 *
 * Google recommends alt text that describes the image content, not keyword stuffing.
 * A good alt text helps visually impaired users understand what the image shows.
 */
export function generateAltText(
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section",
  imagePromptHint?: string | null,
  sectionIndex?: number
): string {
  void sectionIndex; // unused now but kept for API compat
  let alt: string;

  if (imagePromptHint && imagePromptHint.trim().length > 10) {
    // Best case: we know what the image actually shows
    alt = translatePromptToFrenchAlt(imagePromptHint);
  } else if (imageType === "hero") {
    // Hero without prompt hint: generic but descriptive
    alt = `Illustration sur le theme ${keyword.toLowerCase()}`;
  } else if (heading) {
    // Section image: describe based on heading context
    const cleanHeading = heading.replace(/[?!.:]+$/, "").trim();
    alt = `Illustration : ${cleanHeading.toLowerCase()}`;
  } else {
    alt = `Illustration complementaire sur ${keyword.toLowerCase()}`;
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

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
 * - Uses imagePromptHint (Fal.ai prompt) to describe the actual image content
 * - Translates key visual elements from English hint to natural French
 * - Integrates keyword naturally, not as keyword stuffing
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
  // If we have an image prompt hint, use it to describe the actual visual content
  if (imagePromptHint && imagePromptHint.length > 10) {
    const description = translatePromptHintToAlt(imagePromptHint, keyword, heading, imageType, sectionIndex)
    if (description) return truncateAlt(description)
  }

  // Fallback: generate from heading/keyword context
  if (imageType === "hero") {
    const heroFallbacks = [
      `Photo illustrant ${keyword.toLowerCase()}`,
      `Image representant le concept de ${keyword.toLowerCase()}`,
      `Visuel principal sur ${keyword.toLowerCase()}`,
    ]
    return truncateAlt(heroFallbacks[(sectionIndex ?? 0) % heroFallbacks.length])
  }

  if (heading) {
    const cleanHeading = heading
      .replace(/[?!.:…]+$/g, "")
      .replace(/^\d+[\s.):-]+/, "")
      .trim();

    const idx = sectionIndex ?? 0;
    const patterns = [
      (h: string) => `${h}`,
      (h: string) => `Illustration : ${h.toLowerCase()}`,
      (h: string) => `Photo representant ${h.toLowerCase()}`,
      (h: string) => `Vue detaillee : ${h.toLowerCase()}`,
      (h: string) => `${h} en image`,
    ];
    return truncateAlt(patterns[idx % patterns.length](cleanHeading));
  }

  return truncateAlt(`Illustration complementaire sur ${keyword.toLowerCase()}`);
}

/**
 * Translate an English Fal.ai image prompt hint into a natural French alt text.
 * Extracts the visual scene description and adapts it to French.
 */
function translatePromptHintToAlt(
  hint: string,
  keyword: string,
  heading: string | null,
  imageType: "hero" | "section",
  sectionIndex?: number
): string | null {
  // Common English→French visual vocabulary
  const translations: Record<string, string> = {
    // Scene elements
    "person": "personne", "people": "personnes", "woman": "femme", "man": "homme",
    "professional": "professionnel", "expert": "expert", "team": "equipe",
    "office": "bureau", "workspace": "espace de travail", "desk": "bureau",
    "computer": "ordinateur", "laptop": "ordinateur portable", "screen": "ecran",
    "phone": "telephone", "smartphone": "smartphone",
    "chart": "graphique", "graph": "graphique", "dashboard": "tableau de bord",
    "document": "document", "paper": "papier", "notebook": "carnet",
    "meeting": "reunion", "conference": "conference", "presentation": "presentation",
    "hand": "main", "hands": "mains", "finger": "doigt",
    // Actions
    "working": "travaillant", "typing": "tapant", "writing": "ecrivant",
    "reading": "lisant", "analyzing": "analysant", "discussing": "discutant",
    "looking": "regardant", "showing": "montrant", "holding": "tenant",
    "pointing": "pointant", "using": "utilisant", "sitting": "assis",
    // Objects
    "house": "maison", "building": "batiment", "home": "maison",
    "car": "voiture", "money": "argent", "coins": "pieces", "cash": "especes",
    "key": "cle", "keys": "cles", "lock": "serrure", "door": "porte",
    "garden": "jardin", "plant": "plante", "tree": "arbre", "flower": "fleur",
    "book": "livre", "books": "livres", "pen": "stylo",
    "tool": "outil", "tools": "outils", "hammer": "marteau",
    "camera": "appareil photo", "light": "lumiere", "window": "fenetre",
    "table": "table", "chair": "chaise", "kitchen": "cuisine",
    "food": "nourriture", "coffee": "cafe", "water": "eau",
    // Settings
    "modern": "moderne", "bright": "lumineux", "clean": "epure",
    "natural": "naturel", "warm": "chaleureux", "cozy": "confortable",
    "outdoor": "exterieur", "indoor": "interieur",
    "background": "arriere-plan", "foreground": "premier plan",
    "close-up": "gros plan", "closeup": "gros plan", "aerial": "vue aerienne",
    // Colors & style
    "white": "blanc", "blue": "bleu", "green": "vert", "red": "rouge",
    "colorful": "colore", "minimalist": "minimaliste",
    "photorealistic": "", "realistic": "", "high quality": "", "detailed": "",
    "4k": "", "hd": "", "stock photo": "", "editorial": "",
  }

  // Clean the hint: remove technical/style directives
  let cleaned = hint
    .replace(/\b(photorealistic|ultra realistic|high quality|highly detailed|4k|8k|hd|stock photo|editorial style|professional photo(graphy)?|cinematic|bokeh|shallow depth of field|soft lighting|natural lighting|studio lighting|dramatic lighting)\b/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,|,\s*$/g, '')
    .trim()

  if (cleaned.length < 5) return null

  // Extract key visual elements from the hint
  const words = cleaned.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2)
  const frenchParts: string[] = []
  const usedTranslations = new Set<string>()

  // Try to translate known terms
  for (const [en, fr] of Object.entries(translations)) {
    if (!fr) continue // skip empty (style terms)
    if (cleaned.toLowerCase().includes(en) && !usedTranslations.has(fr)) {
      frenchParts.push(fr)
      usedTranslations.add(fr)
      if (frenchParts.length >= 4) break // keep it concise
    }
  }

  const idx = sectionIndex ?? 0

  // Build natural alt text from translated elements
  if (frenchParts.length >= 2) {
    const keywordLower = keyword.toLowerCase()
    const sceneDescription = frenchParts.slice(0, 3).join(', ')

    if (imageType === "hero") {
      const heroPatterns = [
        `${capitalize(frenchParts[0])} et ${frenchParts[1]} illustrant ${keywordLower}`,
        `Scene avec ${sceneDescription} en lien avec ${keywordLower}`,
        `${capitalize(sceneDescription)} pour illustrer ${keywordLower}`,
      ]
      return heroPatterns[idx % heroPatterns.length]
    }

    // Section: combine scene + heading context
    const cleanHeading = heading
      ? heading.replace(/[?!.:…]+$/g, "").replace(/^\d+[\s.):-]+/, "").trim().toLowerCase()
      : null

    if (cleanHeading) {
      const sectionPatterns = [
        `${capitalize(frenchParts[0])} et ${frenchParts.slice(1, 3).join(', ')} pour ${cleanHeading}`,
        `Scene montrant ${sceneDescription} en rapport avec ${cleanHeading}`,
        `${capitalize(sceneDescription)} illustrant ${cleanHeading}`,
        `Photo de ${frenchParts[0]} avec ${frenchParts[1]} pour ${cleanHeading}`,
        `${capitalize(cleanHeading)} : ${frenchParts[0]} et ${frenchParts[1]}`,
      ]
      return sectionPatterns[idx % sectionPatterns.length]
    }

    const noHeadingPatterns = [
      `${capitalize(sceneDescription)} en lien avec ${keywordLower}`,
      `Photo montrant ${frenchParts[0]} et ${frenchParts[1]} pour ${keywordLower}`,
      `Scene avec ${sceneDescription} sur le theme ${keywordLower}`,
    ]
    return noHeadingPatterns[idx % noHeadingPatterns.length]
  }

  // Not enough translated terms — use the raw hint as best-effort description
  // Take the first meaningful phrase from the hint
  const firstPhrase = cleaned.split(/[,.]/).filter(p => p.trim().length > 5)[0]?.trim()
  if (firstPhrase && firstPhrase.length > 10) {
    const shortPhrase = firstPhrase.length > 60 ? firstPhrase.slice(0, 60).replace(/\s+\S*$/, '') : firstPhrase
    if (heading) {
      const cleanHeading = heading.replace(/[?!.:…]+$/g, "").replace(/^\d+[\s.):-]+/, "").trim().toLowerCase()
      return `${capitalize(shortPhrase)} pour ${cleanHeading}`
    }
    return `${capitalize(shortPhrase)} pour ${keyword.toLowerCase()}`
  }

  return null // fallback to heading-based alt
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

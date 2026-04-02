/**
 * GDS HTML Assembler
 * Transforme les content_blocks[] de SEOproject en bodyHTML propre
 * compatible avec le système de blog de GestionnaireDeSite.
 *
 * Différence clé vs Gutenberg:
 * - Pas de blocs commentés <!-- wp:... -->
 * - H2/H3 doivent avoir des attributs id= pour le TOC auto de GDS
 * - Liens internes au format /blog/{slug}/ (pas des URLs WordPress complètes)
 */

import type { ContentBlock } from '@/lib/supabase/types'

/**
 * Slugifie un texte pour l'utiliser comme id HTML
 */
function slugifyId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * S'assure que les balises h2/h3 ont un attribut id= pour le TOC de GDS.
 * Si l'id est absent ou vide, on le génère depuis le texte du heading.
 */
function ensureHeadingIds(html: string): string {
  return html
    .replace(/<h2(\s[^>]*)?>([^<]*)<\/h2>/gi, (match, attrs, text) => {
      attrs = attrs || ''
      if (/id=["'][^"']+["']/.test(attrs)) return match
      const id = slugifyId(text.replace(/<[^>]+>/g, '').trim())
      return `<h2 id="${id}"${attrs}>${text}</h2>`
    })
    .replace(/<h3(\s[^>]*)?>([^<]*)<\/h3>/gi, (match, attrs, text) => {
      attrs = attrs || ''
      if (/id=["'][^"']+["']/.test(attrs)) return match
      const id = slugifyId(text.replace(/<[^>]+>/g, '').trim())
      return `<h3 id="${id}"${attrs}>${text}</h3>`
    })
}

/**
 * Remplace les URLs WordPress absolues par des URLs GDS relatives.
 * ex: https://site.com/blog/article/ → /blog/article/
 * Conserve les liens externes intacts.
 */
function rewriteInternalLinks(html: string, siteDomain: string): string {
  if (!siteDomain) return html
  const domain = siteDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const regex = new RegExp(`https?://${domain.replace('.', '\\.')}(/[^"']*)`, 'gi')
  return html.replace(regex, '$1')
}

/**
 * Remplace les URLs d'images WordPress absolues par des chemins GDS.
 * wp-content/uploads/... → /site-images/...
 * Utilisé quand les images ont déjà été re-uploadées sur GDS.
 */
function rewriteImageSrcs(
  html: string,
  imageMap: Record<string, string>
): string {
  let result = html
  for (const [wpUrl, gdsPath] of Object.entries(imageMap)) {
    result = result.split(wpUrl).join(gdsPath)
  }
  return result
}

/**
 * Nettoie les classes et attributs spécifiques à WordPress/Gutenberg
 * qui pourraient être injectés dans le HTML des blocs.
 */
function stripWordpressMarkup(html: string): string {
  return html
    // Supprime les classes wp-*
    .replace(/\s*class="([^"]*\bwp-[^"]*)"/gi, (match, cls) => {
      const cleaned = cls.split(/\s+/).filter((c: string) => !c.startsWith('wp-')).join(' ').trim()
      return cleaned ? ` class="${cleaned}"` : ''
    })
    // Supprime data-wp-* attributs
    .replace(/\s*data-wp-[a-z-]+="[^"]*"/gi, '')
}

/**
 * Assemble le bodyHTML final depuis les content_blocks de SEOproject.
 * Résultat prêt à être envoyé dans le champ bodyHTML du POST /api/blog/create de GDS.
 */
export function assembleBodyHtml(
  contentBlocks: ContentBlock[],
  options: {
    siteDomain?: string
    imageMap?: Record<string, string>  // wpUrl → gdsPath
  } = {}
): string {
  const parts: string[] = []

  for (const block of contentBlocks) {
    if (!block.content_html) continue

    // Ajoute le heading du bloc si présent (h2/h3/h4)
    if (block.heading && (block.type === 'h2' || block.type === 'h3' || block.type === 'h4')) {
      const id = slugifyId(block.heading)
      parts.push(`<${block.type} id="${id}">${block.heading}</${block.type}>`)
    }

    let blockHtml = block.content_html

    // Réécrit les URLs d'images si un mapping est fourni
    if (options.imageMap && Object.keys(options.imageMap).length > 0) {
      blockHtml = rewriteImageSrcs(blockHtml, options.imageMap)
    }

    // Réécrit les liens internes WordPress → GDS
    if (options.siteDomain) {
      blockHtml = rewriteInternalLinks(blockHtml, options.siteDomain)
    }

    // Nettoie le markup WordPress résiduel
    blockHtml = stripWordpressMarkup(blockHtml)

    // S'assure que les h2/h3 dans le contenu ont des ids
    blockHtml = ensureHeadingIds(blockHtml)

    parts.push(blockHtml)
  }

  return parts.join('\n\n')
}

/**
 * Mappe une catégorie libre SEOproject vers une catégorie GDS.
 * Utilise le gds_category_map du site en priorité,
 * puis une correspondance par défaut basée sur des mots-clés.
 */
export function mapCategoryToGds(
  category: string | null | undefined,
  categoryMap: Record<string, string>
): string {
  if (!category) return 'Conseils'

  // 1. Lookup exact dans le map du site
  const lower = category.toLowerCase().trim()
  for (const [from, to] of Object.entries(categoryMap)) {
    if (from.toLowerCase() === lower) return to
  }

  // 2. Correspondance par mot-clé
  if (/mariage|wedding|nuptial/i.test(category)) return 'Mariage'
  if (/entreprise|corporate|business|professionnel/i.test(category)) return 'Entreprise'
  if (/anniversaire|birthday|f[eê]te/i.test(category)) return 'Anniversaire'

  // 3. Fallback
  return 'Conseils'
}

/**
 * Mappe un persona SEOproject vers un auteur GDS (mathilde | elise).
 * Utilise le gds_author configuré sur le site par défaut.
 */
export function mapPersonaToGdsAuthor(
  personaName: string | null | undefined,
  gdsAuthor: string
): 'mathilde' | 'elise' {
  const valid = ['mathilde', 'elise']
  if (valid.includes(gdsAuthor)) return gdsAuthor as 'mathilde' | 'elise'
  if (/elise|élise/i.test(personaName || '')) return 'elise'
  return 'mathilde'
}

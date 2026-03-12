// ============================================================
// WP Cleaner — Strip Elementor/Gutenberg markup to clean HTML
// Preserves: internal links, CTAs, images, meaningful content
// ============================================================

import type { PageBuilder } from './types'

/**
 * Detect whether HTML content was built with Elementor or Gutenberg.
 */
export function detectPageBuilder(html: string): PageBuilder {
  if (!html) return 'unknown'

  // Elementor markers
  if (
    html.includes('data-widget_type') ||
    html.includes('elementor-widget') ||
    html.includes('elementor-element') ||
    html.includes('data-element_type')
  ) {
    return 'elementor'
  }

  // Gutenberg markers
  if (
    html.includes('<!-- wp:') ||
    html.includes('wp-block-') ||
    html.includes('has-text-align-')
  ) {
    return 'gutenberg'
  }

  return 'unknown'
}

/**
 * Extract all links from HTML content, classified as internal or external.
 */
export function extractLinks(html: string, siteDomain: string): { url: string; anchor: string; isInternal: boolean }[] {
  const links: { url: string; anchor: string; isInternal: boolean }[] = []
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].trim()
    const anchor = match[2].replace(/<[^>]*>/g, '').trim()

    if (!url || url.startsWith('#') || url.startsWith('javascript:')) continue

    const domain = siteDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const isInternal = url.includes(domain) || url.startsWith('/')

    links.push({ url, anchor, isInternal })
  }

  return links
}

/**
 * Extract CTA patterns from HTML content.
 * Detects: buttons, call-to-action divs, Elementor CTA widgets.
 */
export function extractCTAs(html: string): string[] {
  const ctas: string[] = []

  // Button patterns
  const buttonRegex = /<(?:a|button)\s+[^>]*class="[^"]*(?:btn|button|cta|elementor-button|wp-block-button)[^"]*"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/(?:a|button)>/gi
  let match: RegExpExecArray | null
  while ((match = buttonRegex.exec(html)) !== null) {
    const text = match[0].replace(/<[^>]*>/g, '').trim()
    if (text.length > 3) ctas.push(match[0])
  }

  // Elementor CTA widget
  const ctaWidgetRegex = /<div[^>]*data-widget_type="call-to-action[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi
  while ((match = ctaWidgetRegex.exec(html)) !== null) {
    ctas.push(match[0])
  }

  return ctas
}

/**
 * Clean Elementor HTML to semantic HTML.
 * Strips layout wrappers, data attributes, inline styles, while preserving content.
 */
function cleanElementor(html: string): string {
  let cleaned = html

  // Remove Elementor section/column/widget wrapper divs but keep inner content
  // Strategy: flatten by removing div wrappers with elementor classes

  // Remove data-* attributes
  cleaned = cleaned.replace(/\s+data-[a-z_-]+="[^"]*"/gi, '')

  // Remove elementor-specific classes but keep the element
  cleaned = cleaned.replace(/\s+class="[^"]*elementor[^"]*"/gi, '')

  // Remove empty divs left after stripping
  cleaned = cleaned.replace(/<div\s*>\s*<\/div>/gi, '')

  // Remove Elementor widget wrappers (keep content inside)
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-widget-container[^"]*"[^>]*>/gi, '')
  cleaned = cleaned.replace(/<section[^>]*class="[^"]*elementor-section[^"]*"[^>]*>/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-container[^"]*"[^>]*>/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-column[^"]*"[^>]*>/gi, '')
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-element[^"]*"[^>]*>/gi, '')

  // Clean up inline styles (except on tables and images)
  cleaned = cleaned.replace(/(<(?!table|img|th|td)[a-z][a-z0-9]*)\s+style="[^"]*"/gi, '$1')

  // Remove empty wrapper divs (multi-pass)
  for (let i = 0; i < 5; i++) {
    cleaned = cleaned.replace(/<div\s*>\s*<\/div>/gi, '')
    cleaned = cleaned.replace(/<div>\s*(<(?:h[2-6]|p|ul|ol|table|details|blockquote|figure|img)[^>]*>)/gi, '$1')
  }

  // Remove closing divs that are orphaned
  // Count opens vs closes and trim excess
  cleaned = balanceDivs(cleaned)

  return normalizeWhitespace(cleaned)
}

/**
 * Clean Gutenberg HTML to semantic HTML.
 * Strips wp:* comments and wp-block-* classes.
 */
function cleanGutenberg(html: string): string {
  let cleaned = html

  // Remove Gutenberg block comments
  cleaned = cleaned.replace(/<!--\s*\/?wp:[^>]*-->/g, '')

  // Remove wp-block-* classes but keep elements
  cleaned = cleaned.replace(/\s+class="[^"]*wp-block-[^"]*"/gi, (match) => {
    // Keep class if it also has non-wp classes
    const classes = match.match(/class="([^"]*)"/)?.[1] || ''
    const nonWpClasses = classes
      .split(/\s+/)
      .filter(c => !c.startsWith('wp-block-') && !c.startsWith('has-') && c !== 'is-layout-flow' && c !== 'is-layout-constrained')
      .join(' ')
      .trim()
    return nonWpClasses ? ` class="${nonWpClasses}"` : ''
  })

  // Remove wp:spacer blocks entirely
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*wp-block-spacer[^"]*"[^>]*><\/div>/gi, '')

  // Clean up inline styles (except on tables and images)
  cleaned = cleaned.replace(/(<(?!table|img|th|td|figure)[a-z][a-z0-9]*)\s+style="[^"]*"/gi, '$1')

  // Remove empty divs
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned.replace(/<div\s*>\s*<\/div>/gi, '')
  }

  return normalizeWhitespace(cleaned)
}

/**
 * Balance div open/close tags by removing excess closing divs.
 */
function balanceDivs(html: string): string {
  let depth = 0
  const result: string[] = []
  const parts = html.split(/(<\/?div[^>]*>)/gi)

  for (const part of parts) {
    if (/<div[^>]*>/i.test(part)) {
      depth++
      result.push(part)
    } else if (/<\/div>/i.test(part)) {
      if (depth > 0) {
        depth--
        result.push(part)
      }
      // Skip orphaned closing divs
    } else {
      result.push(part)
    }
  }

  return result.join('')
}

function normalizeWhitespace(html: string): string {
  return html
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}

/**
 * Main cleaner: strip page builder markup, keep semantic HTML.
 * Preserves: h2-h6, p, ul/ol/li, table, details/summary, a, img, blockquote, figure.
 */
export function cleanWPHtml(html: string, pageBuilder: PageBuilder): string {
  if (!html || !html.trim()) return ''

  switch (pageBuilder) {
    case 'elementor':
      return cleanElementor(html)
    case 'gutenberg':
      return cleanGutenberg(html)
    default:
      // Unknown builder: do minimal cleanup
      return cleanGutenberg(cleanElementor(html))
  }
}

/**
 * Parse WordPress HTML content into ContentBlock[] structure.
 * Splits by heading tags (h2, h3, h4), detects FAQ/list blocks.
 */

import type { ContentBlock } from '@/lib/supabase/types'

function generateId(): string {
  return crypto.randomUUID()
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.split(' ').length : 0
}

function stripOuterTag(html: string): string {
  return html.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '')
}

/**
 * Detect if HTML content is dominated by a FAQ pattern (details/summary)
 */
function isFaqContent(html: string): boolean {
  return /<details[\s>]/i.test(html) && /<summary[\s>]/i.test(html)
}

/**
 * Detect if HTML content is dominated by list elements
 */
function isListContent(html: string): boolean {
  const listMatches = (html.match(/<(ul|ol)[\s>]/gi) || []).length
  const pMatches = (html.match(/<p[\s>]/gi) || []).length
  return listMatches > 0 && listMatches >= pMatches
}

interface HeadingMatch {
  tag: 'h2' | 'h3' | 'h4'
  text: string
  index: number
  fullMatch: string
}

/**
 * Parse WordPress HTML into ContentBlock[].
 *
 * Strategy:
 * - Split by <h2>, <h3>, <h4> tags
 * - Text before first heading → paragraph block (intro)
 * - Each heading + subsequent content → block of matching type
 * - Detect <details>/<summary> → faq type
 * - Detect <ul>/<ol> dominant → list type
 */
export function parseHtmlToBlocks(html: string): ContentBlock[] {
  if (!html || !html.trim()) return []

  const blocks: ContentBlock[] = []

  // Find all heading positions
  const headingRegex = /<(h[234])(?:\s[^>]*)?>(.+?)<\/\1>/gi
  const headings: HeadingMatch[] = []
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      tag: match[1].toLowerCase() as 'h2' | 'h3' | 'h4',
      text: stripOuterTag(match[0]).replace(/<[^>]*>/g, '').trim(),
      index: match.index,
      fullMatch: match[0],
    })
  }

  // If no headings at all, create a single paragraph block
  if (headings.length === 0) {
    const cleaned = html.trim()
    if (cleaned) {
      blocks.push({
        id: generateId(),
        type: 'paragraph',
        heading: undefined,
        content_html: cleaned,
        nugget_ids: [],
        word_count: countWords(cleaned),
        status: 'written',
      })
    }
    return blocks
  }

  // Extract intro (content before first heading)
  const introHtml = html.substring(0, headings[0].index).trim()
  if (introHtml && countWords(introHtml) > 5) {
    blocks.push({
      id: generateId(),
      type: 'paragraph',
      heading: undefined,
      content_html: introHtml,
      nugget_ids: [],
      word_count: countWords(introHtml),
      status: 'written',
    })
  }

  // Process each heading and its content
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    const contentStart = heading.index + heading.fullMatch.length
    const contentEnd = i + 1 < headings.length ? headings[i + 1].index : html.length
    const contentHtml = html.substring(contentStart, contentEnd).trim()

    // Determine block type
    let blockType: ContentBlock['type'] = heading.tag
    if (isFaqContent(contentHtml)) {
      blockType = 'faq'
    } else if (isListContent(contentHtml)) {
      blockType = 'list'
    }

    blocks.push({
      id: generateId(),
      type: blockType,
      heading: heading.text,
      content_html: contentHtml,
      nugget_ids: [],
      word_count: countWords(contentHtml),
      status: 'written',
    })
  }

  return blocks
}

/**
 * Extract a main keyword from a post title.
 * Removes common French stop words and returns the remaining core terms.
 */
export function extractMainKeyword(title: string): string {
  const stopWords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'da', 'd',
    'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car',
    'a', 'au', 'aux', 'en', 'dans', 'sur', 'sous', 'par', 'pour', 'avec', 'sans',
    'ce', 'cette', 'ces', 'mon', 'ton', 'son', 'notre', 'votre', 'leur',
    'que', 'qui', 'quoi', 'dont', 'ou',
    'ne', 'pas', 'plus', 'jamais', 'rien',
    'est', 'sont', 'etre', 'avoir', 'fait', 'faire',
    'il', 'elle', 'ils', 'elles', 'on', 'nous', 'vous',
    'tout', 'tous', 'toute', 'toutes', 'autre', 'autres',
    'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'quels', 'quelles',
    'l', 's', 'n', 'c', 'j', 'y',
  ])

  // Clean HTML entities and special chars
  const cleaned = title
    .replace(/&#?\w+;/g, ' ')
    .replace(/[^\w\sàâäéèêëïîôùûüÿçœæ'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))

  // Return up to 4 most meaningful words
  return words.slice(0, 4).join(' ') || cleaned.toLowerCase()
}

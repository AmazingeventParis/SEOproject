/**
 * Convert raw HTML into native WordPress Gutenberg blocks.
 * Each top-level element becomes its own editable block.
 */
export function convertHtmlToGutenbergBlocks(html: string): string {
  if (!html.trim()) return ''

  // If already contains Gutenberg block comments, return as-is
  if (html.includes('<!-- wp:')) return html

  const elements = splitHtmlTopLevel(html)
  const blocks: string[] = []

  for (const el of elements) {
    const trimmed = el.trim()
    if (!trimmed) continue

    // <p> → wp:paragraph (native, fully editable)
    if (/^<p[\s>]/i.test(trimmed) && /<\/p>\s*$/i.test(trimmed)) {
      blocks.push(`<!-- wp:paragraph -->\n${trimmed}\n<!-- /wp:paragraph -->`)
    }
    // <ul> → wp:list (native)
    else if (/^<ul[\s>]/i.test(trimmed) && /<\/ul>\s*$/i.test(trimmed)) {
      blocks.push(`<!-- wp:list -->\n${trimmed}\n<!-- /wp:list -->`)
    }
    // <ol> → wp:list {"ordered":true} (native)
    else if (/^<ol[\s>]/i.test(trimmed) && /<\/ol>\s*$/i.test(trimmed)) {
      blocks.push(`<!-- wp:list {"ordered":true} -->\n${trimmed}\n<!-- /wp:list -->`)
    }
    // <blockquote> → wp:quote (native)
    else if (/^<blockquote[\s>]/i.test(trimmed) && /<\/blockquote>\s*$/i.test(trimmed)) {
      blocks.push(`<!-- wp:quote -->\n${trimmed}\n<!-- /wp:quote -->`)
    }
    // <figure> with <img> → wp:image (native)
    else if (/^<figure[\s>]/i.test(trimmed)) {
      const imgMatch = trimmed.match(/<img[^>]+>/i)
      if (imgMatch) {
        blocks.push(`<!-- wp:image -->\n<figure class="wp-block-image">${imgMatch[0]}</figure>\n<!-- /wp:image -->`)
      } else {
        blocks.push(`<!-- wp:html -->\n${trimmed}\n<!-- /wp:html -->`)
      }
    }
    // Tables, callouts, FAQ details, other divs → wp:html (custom HTML, separate block each)
    else {
      blocks.push(`<!-- wp:html -->\n${trimmed}\n<!-- /wp:html -->`)
    }
  }

  return blocks.join('\n\n')
}

/**
 * Split an HTML string into top-level block elements.
 * Each <p>, <ul>, <ol>, <table>, <div>, <figure>, <blockquote>, <details>
 * becomes a separate entry. Inline text between blocks is wrapped in <p>.
 */
function splitHtmlTopLevel(html: string): string[] {
  const results: string[] = []
  const blockTags = 'p|ul|ol|div|table|figure|blockquote|details|section|hr'
  const regex = new RegExp(
    `(<(?:${blockTags})(?:\\s[^>]*)?>(?:[\\s\\S]*?)<\\/(?:${blockTags})>|<hr\\s*\\/?>)`,
    'gi'
  )

  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const between = html.slice(lastIndex, match.index).trim()
    if (between) {
      results.push(`<p>${between}</p>`)
    }
    results.push(match[0])
    lastIndex = match.index + match[0].length
  }

  const tail = html.slice(lastIndex).trim()
  if (tail) {
    if (!/<(?:p|ul|ol|div|table|figure|blockquote|details)[\s>]/i.test(tail)) {
      results.push(`<p>${tail}</p>`)
    } else {
      results.push(tail)
    }
  }

  return results
}

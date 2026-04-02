// ============================================================
// Broken Link Checker
// Verifies all links in content_blocks are reachable (HEAD requests)
// ============================================================

export interface LinkCheckResult {
  url: string
  status: number | null
  ok: boolean
  error?: string
  blockIndex: number
  anchorText: string
  type: 'internal' | 'external'
}

export interface LinkCheckSummary {
  checkedAt: string
  totalLinks: number
  brokenLinks: number
  redirectedLinks: number
  okLinks: number
  results: LinkCheckResult[]
}

/**
 * Extract all <a href="..."> links from HTML content blocks.
 */
function extractLinks(
  contentHtml: string,
  blockIndex: number,
  siteDomain: string,
): { url: string; anchorText: string; blockIndex: number; type: 'internal' | 'external' }[] {
  const links: { url: string; anchorText: string; blockIndex: number; type: 'internal' | 'external' }[] = []
  const regex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(contentHtml)) !== null) {
    const url = match[1].trim()
    const anchorText = match[2].replace(/<[^>]*>/g, '').trim()

    // Skip mailto, tel, javascript
    if (/^(mailto:|tel:|javascript:)/i.test(url)) continue

    const cleanDomain = siteDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    const isInternal = url.includes(cleanDomain) || url.startsWith('/')

    links.push({ url, anchorText, blockIndex, type: isInternal ? 'internal' : 'external' })
  }

  return links
}

/**
 * Check a single URL via HEAD request with timeout.
 * Falls back to GET if HEAD is not allowed (405).
 */
async function checkUrl(url: string): Promise<{ status: number | null; ok: boolean; error?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000) // 8s timeout

  try {
    // Try HEAD first (faster, less bandwidth)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOContentStudio/1.0; Link Checker)',
      },
    })
    clearTimeout(timeout)

    // Some servers reject HEAD — retry with GET
    if (res.status === 405 || res.status === 403) {
      const controller2 = new AbortController()
      const timeout2 = setTimeout(() => controller2.abort(), 8000)
      try {
        const res2 = await fetch(url, {
          method: 'GET',
          signal: controller2.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SEOContentStudio/1.0; Link Checker)',
          },
        })
        clearTimeout(timeout2)
        return { status: res2.status, ok: res2.status >= 200 && res2.status < 400 }
      } catch {
        clearTimeout(timeout2)
        return { status: res.status, ok: false, error: 'HEAD rejecte, GET echoue' }
      }
    }

    return { status: res.status, ok: res.status >= 200 && res.status < 400 }
  } catch (err) {
    clearTimeout(timeout)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('abort')) {
      return { status: null, ok: false, error: 'Timeout (8s)' }
    }
    return { status: null, ok: false, error: msg }
  }
}

/**
 * Check all links in article content blocks.
 * Runs checks in parallel (max 5 concurrent) with deduplication.
 */
export async function checkBrokenLinks(
  contentBlocks: { content_html: string; type: string; status: string }[],
  siteDomain: string,
): Promise<LinkCheckSummary> {
  // Extract all links
  const allLinks: { url: string; anchorText: string; blockIndex: number; type: 'internal' | 'external' }[] = []
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    if (!block.content_html || block.status === 'pending') continue
    const links = extractLinks(block.content_html, i, siteDomain)
    allLinks.push(...links)
  }

  // Deduplicate by URL (keep first occurrence for report)
  const urlMap = new Map<string, typeof allLinks[0]>()
  for (const link of allLinks) {
    if (!urlMap.has(link.url)) {
      urlMap.set(link.url, link)
    }
  }
  const uniqueLinks = Array.from(urlMap.values())

  // Check all URLs in parallel batches of 5
  const BATCH_SIZE = 5
  const results: LinkCheckResult[] = []

  for (let i = 0; i < uniqueLinks.length; i += BATCH_SIZE) {
    const batch = uniqueLinks.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async (link) => {
        const check = await checkUrl(link.url)
        return {
          url: link.url,
          status: check.status,
          ok: check.ok,
          error: check.error,
          blockIndex: link.blockIndex,
          anchorText: link.anchorText,
          type: link.type,
        } as LinkCheckResult
      })
    )

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
      }
    }
  }

  const broken = results.filter(r => !r.ok)
  const redirected = results.filter(r => r.status && r.status >= 300 && r.status < 400)
  const ok = results.filter(r => r.ok && r.status && r.status < 300)

  return {
    checkedAt: new Date().toISOString(),
    totalLinks: results.length,
    brokenLinks: broken.length,
    redirectedLinks: redirected.length,
    okLinks: ok.length,
    results: broken, // Only store broken links to keep data lean
  }
}

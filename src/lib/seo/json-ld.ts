// ============================================================
// JSON-LD structured data generators
// Generates Schema.org markup for articles, FAQs, breadcrumbs
// ============================================================

// ---- Types ----

export interface ArticleSchemaParams {
  title: string
  description: string
  slug: string
  siteDomain: string
  personaName: string
  personaRole: string
  publishedAt: string | null
  updatedAt: string
  wordCount: number
  imageUrl?: string
  personaBio?: string
  personaAvatarUrl?: string
  personaSameAs?: string[]
}

export interface ClaimReviewItem {
  claimText: string
  sourceUrl: string
  sourceName: string
}

// ---- Article schema ----

/**
 * Generate a Schema.org Article JSON-LD object.
 *
 * @param params  Article metadata including title, slug, author info, dates, etc.
 * @returns       A JSON-LD object ready for embedding in a <script type="application/ld+json"> tag
 */
export function generateArticleSchema(
  params: ArticleSchemaParams
): Record<string, unknown> {
  const {
    title,
    description,
    slug,
    siteDomain,
    personaName,
    personaRole,
    publishedAt,
    updatedAt,
    wordCount,
    imageUrl,
    personaBio,
    personaAvatarUrl,
    personaSameAs,
  } = params

  const articleUrl = `https://${siteDomain}/${slug}`

  // Build enriched author object for E-E-A-T
  const author: Record<string, unknown> = {
    '@type': 'Person',
    name: personaName,
    jobTitle: personaRole,
  }
  if (personaBio) author.description = personaBio
  if (personaAvatarUrl) author.image = personaAvatarUrl
  if (personaSameAs && personaSameAs.length > 0) author.sameAs = personaSameAs

  const schema: Record<string, unknown> = {
    '@type': 'Article',
    headline: title,
    description,
    author,
    datePublished: publishedAt ?? updatedAt,
    dateModified: updatedAt,
    wordCount,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: siteDomain,
      url: `https://${siteDomain}`,
    },
  }

  if (imageUrl) {
    schema.image = {
      '@type': 'ImageObject',
      url: imageUrl,
    }
  }

  return schema
}

// ---- FAQ schema ----

/**
 * Generate a Schema.org FAQPage JSON-LD object from FAQ items.
 *
 * @param faqItems  Array of question/answer pairs
 * @returns         A JSON-LD FAQPage object, or null if the array is empty
 */
export function generateFAQSchema(
  faqItems: { question: string; answer: string }[]
): Record<string, unknown> | null {
  if (faqItems.length === 0) return null

  return {
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }
}

// ---- Breadcrumb schema ----

/**
 * Generate a Schema.org BreadcrumbList JSON-LD object.
 * Produces a 3-level breadcrumb: Home -> Blog -> Article title.
 *
 * @param siteDomain    The site domain (e.g. "example.com")
 * @param siteName      The human-readable site name
 * @param articleTitle   The article title for the last breadcrumb item
 * @param articleSlug    The article slug for URL construction
 * @returns             A JSON-LD BreadcrumbList object
 */
export function generateBreadcrumbSchema(
  siteDomain: string,
  siteName: string,
  articleTitle: string,
  articleSlug: string,
  blogPath?: string | null
): Record<string, unknown> {
  const baseUrl = `https://${siteDomain}`
  const resolvedBlogPath = (blogPath || 'blog').replace(/^\/|\/$/g, '')
  const blogLabel = resolvedBlogPath.charAt(0).toUpperCase() + resolvedBlogPath.slice(1)

  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: siteName,
        item: {
          '@type': 'WebPage',
          '@id': baseUrl,
        },
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: blogLabel,
        item: {
          '@type': 'WebPage',
          '@id': `${baseUrl}/${resolvedBlogPath}`,
        },
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: articleTitle,
        item: {
          '@type': 'WebPage',
          '@id': `${baseUrl}/${articleSlug}`,
        },
      },
    ],
  }
}

// ---- HowTo schema ----

export interface HowToStep {
  name: string
  text: string
}

/**
 * Generate a Schema.org HowTo JSON-LD object.
 * Used for tutorial/informational articles that have step-by-step content.
 *
 * @param title  The article title (becomes HowTo name)
 * @param steps  Array of step name/text pairs (extracted from H2/H3 sections)
 * @returns      A JSON-LD HowTo object, or null if fewer than 2 steps
 */
export function generateHowToSchema(
  title: string,
  description: string,
  steps: HowToStep[]
): Record<string, unknown> | null {
  if (steps.length < 2) return null

  return {
    '@type': 'HowTo',
    name: title,
    description,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  }
}

// ---- Review schema ----

/**
 * Generate a Schema.org Review JSON-LD object.
 * Used for review/comparison articles.
 *
 * @param itemName    The product/service being reviewed
 * @param reviewBody  Summary of the review (from meta description)
 * @param authorName  The reviewer/persona name
 * @returns           A JSON-LD Review object
 */
export function generateReviewSchema(
  itemName: string,
  reviewBody: string,
  authorName: string
): Record<string, unknown> {
  return {
    '@type': 'Review',
    itemReviewed: {
      '@type': 'Thing',
      name: itemName,
    },
    reviewBody,
    author: {
      '@type': 'Person',
      name: authorName,
    },
  }
}

// ---- ClaimReview schema ----

/**
 * Generate Schema.org ClaimReview JSON-LD objects from sourced claims in the article.
 * Detects external links that cite factual claims and generates ClaimReview markup.
 *
 * @param contentHtml   Full article HTML
 * @param authorName    The reviewer/persona name
 * @param siteDomain    The site domain for the review publisher
 * @returns             Array of ClaimReview schema objects
 */
export function generateClaimReviewSchemas(
  contentHtml: string,
  authorName: string,
  siteDomain: string,
): Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = []

  // Find paragraphs that contain both an external link and factual language patterns
  // Pattern: text with a claim indicator + an <a> linking to an external source
  const factualPatterns = [
    /selon\s+(?:une\s+)?(?:etude|enquete|rapport|sondage|analyse|recherche)/i,
    /d['']apres\s+(?:une\s+)?(?:etude|enquete|rapport|les\s+donnees|les\s+chiffres)/i,
    /(?:une\s+)?etude\s+(?:publiee|realisee|menee|de\s+\d{4})/i,
    /(?:les\s+)?(?:chiffres|donnees|statistiques)\s+(?:de|du|montrent|indiquent|revelent)/i,
    /(\d+[\s,.]?\d*)\s*%\s+(?:des?|du|de\s+la)/i,
    /(?:INSEE|OMS|WHO|ADEME|ANSES|HAS|Eurostat)\s/i,
  ]

  // Split into blocks around <p> tags
  const paragraphs = contentHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []

  for (const para of paragraphs) {
    const plainText = para.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

    // Check if paragraph has a factual claim pattern
    const hasFactualClaim = factualPatterns.some(p => p.test(plainText))
    if (!hasFactualClaim) continue

    // Extract external links from the paragraph
    const linkRegex = /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]+)<\/a>/gi
    let linkMatch
    while ((linkMatch = linkRegex.exec(para)) !== null) {
      const sourceUrl = linkMatch[1]
      const anchorText = linkMatch[2].trim()

      // Skip internal links
      if (sourceUrl.includes(siteDomain)) continue

      // Extract the claim sentence (sentence containing the link or the factual pattern)
      const sentences = plainText.split(/(?<=[.!?])\s+/)
      const claimSentence = sentences.find(s =>
        factualPatterns.some(p => p.test(s)) || s.includes(anchorText)
      )
      if (!claimSentence || claimSentence.length < 20) continue

      // Extract source name from URL
      let sourceName = ''
      try {
        sourceName = new URL(sourceUrl).hostname.replace(/^www\./, '')
      } catch { continue }

      schemas.push({
        '@type': 'ClaimReview',
        claimReviewed: claimSentence.slice(0, 200),
        author: {
          '@type': 'Person',
          name: authorName,
        },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: 5,
          bestRating: 5,
          worstRating: 1,
          alternateName: 'Vrai',
        },
        itemReviewed: {
          '@type': 'Claim',
          author: {
            '@type': 'Organization',
            name: sourceName,
          },
          appearance: {
            '@type': 'WebPage',
            url: sourceUrl,
          },
        },
      })

      // Max 3 ClaimReview per article
      if (schemas.length >= 3) break
    }
    if (schemas.length >= 3) break
  }

  return schemas
}

// ---- Citation density analyzer ----

/**
 * Analyze citation/source density in the article content.
 * Counts external links, study references, data points per 1000 words.
 */
export function analyzeCitationDensity(
  contentHtml: string,
  wordCount: number,
): {
  externalLinkCount: number
  studyReferenceCount: number
  dataPointCount: number
  densityPer1000: number
  status: 'excellent' | 'good' | 'low' | 'none'
} {
  const plainText = contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

  // Count external links (exclude internal anchors)
  const externalLinks = (contentHtml.match(/<a\s+[^>]*href=["']https?:\/\/[^"']+["']/gi) || [])
  const externalLinkCount = externalLinks.length

  // Count study/research references
  const studyPatterns = [
    /(?:etude|enquete|rapport|sondage|recherche|meta-analyse)\s+(?:publiee|realisee|menee|de\s+\d{4})/gi,
    /selon\s+(?:une\s+)?(?:etude|enquete|rapport)/gi,
    /d['']apres\s+(?:une\s+)?(?:etude|les\s+donnees|les\s+chiffres)/gi,
    /(?:source|ref\.?|reference)\s*:/gi,
  ]
  let studyReferenceCount = 0
  for (const pattern of studyPatterns) {
    const matches = plainText.match(pattern)
    if (matches) studyReferenceCount += matches.length
  }

  // Count data points (percentages, precise numbers with units)
  const dataPatterns = [
    /\d+[\s,.]?\d*\s*%/g,
    /\d+[\s,.]?\d*\s*(?:euros?|€|\$|millions?|milliards?|kg|km|m2|m²|kWh|litres?)/gi,
  ]
  let dataPointCount = 0
  for (const pattern of dataPatterns) {
    const matches = plainText.match(pattern)
    if (matches) dataPointCount += matches.length
  }

  const totalSignals = externalLinkCount + studyReferenceCount + dataPointCount
  const densityPer1000 = wordCount > 0 ? Math.round((totalSignals / wordCount) * 1000 * 10) / 10 : 0

  let status: 'excellent' | 'good' | 'low' | 'none' = 'none'
  if (densityPer1000 >= 5) status = 'excellent'
  else if (densityPer1000 >= 2) status = 'good'
  else if (totalSignals > 0) status = 'low'

  return { externalLinkCount, studyReferenceCount, dataPointCount, densityPer1000, status }
}

// ---- Graph assembler ----

/**
 * Combine multiple JSON-LD schemas into a single @graph structure.
 * This is the recommended way to output multiple schemas on one page.
 *
 * @param schemas  Array of JSON-LD schema objects (without @context)
 * @returns        A single JSON-LD object with @context and @graph
 */
export function assembleJsonLd(
  schemas: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': schemas,
  }
}

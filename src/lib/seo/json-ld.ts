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
  } = params

  const articleUrl = `https://${siteDomain}/${slug}`

  const schema: Record<string, unknown> = {
    '@type': 'Article',
    headline: title,
    description,
    author: {
      '@type': 'Person',
      name: personaName,
      jobTitle: personaRole,
    },
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
  articleSlug: string
): Record<string, unknown> {
  const baseUrl = `https://${siteDomain}`

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
        name: 'Blog',
        item: {
          '@type': 'WebPage',
          '@id': `${baseUrl}/blog`,
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

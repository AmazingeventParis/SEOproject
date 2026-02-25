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

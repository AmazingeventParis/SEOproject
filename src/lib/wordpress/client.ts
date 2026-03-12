import { getServerClient } from '@/lib/supabase/client'
import type {
  WPPost,
  WPCategory,
  WPCreatePostInput,
  WPUpdatePostInput,
  WPUploadMediaInput,
} from './types'

// ---------- Credentials ----------

interface WPCredentials {
  wpUrl: string
  wpUser: string
  wpAppPassword: string
}

/**
 * Fetch WordPress credentials for a given site from Supabase.
 * The wp_url stored in the database is the site base URL (e.g. "https://example.com").
 * We append `/wp-json/wp/v2` when building API requests.
 */
async function getWPCredentials(siteId: string): Promise<WPCredentials> {
  const supabase = getServerClient()

  const { data, error } = await supabase
    .from('seo_sites')
    .select('wp_url, wp_user, wp_app_password')
    .eq('id', siteId)
    .single()

  if (error || !data) {
    throw new Error(
      `Impossible de recuperer les identifiants WordPress pour le site ${siteId} : ${error?.message ?? 'site introuvable'}`
    )
  }

  const { wp_url, wp_user, wp_app_password } = data

  if (!wp_url || !wp_user || !wp_app_password) {
    throw new Error(
      'Les identifiants WordPress sont incomplets. Verifiez wp_url, wp_user et wp_app_password dans les parametres du site.'
    )
  }

  return {
    wpUrl: wp_url.replace(/\/+$/, ''),
    wpUser: wp_user,
    wpAppPassword: wp_app_password,
  }
}

// ---------- Auth helper ----------

function buildAuthHeader(creds: WPCredentials): string {
  const token = Buffer.from(`${creds.wpUser}:${creds.wpAppPassword}`).toString('base64')
  return `Basic ${token}`
}

/**
 * Build the WP REST API base URL from credentials.
 */
function apiBase(creds: WPCredentials): string {
  return `${creds.wpUrl}/wp-json/wp/v2`
}

// ---------- Public API ----------

/**
 * Test the WordPress connection by calling GET /users/me.
 * Returns true if credentials are valid, false otherwise.
 */
export async function testConnection(siteId: string): Promise<boolean> {
  try {
    const creds = await getWPCredentials(siteId)

    const response = await fetch(`${apiBase(creds)}/users/me`, {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(creds),
        'Content-Type': 'application/json',
      },
    })

    return response.ok
  } catch {
    return false
  }
}

/**
 * Create a new post on the WordPress site.
 * Returns the new post's WordPress ID and public URL.
 */
export async function createPost(
  siteId: string,
  input: WPCreatePostInput
): Promise<{ wpPostId: number; wpUrl: string }> {
  const creds = await getWPCredentials(siteId)

  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    slug: input.slug,
    status: input.status,
  }

  if (input.excerpt) body.excerpt = input.excerpt
  if (input.categories) body.categories = input.categories
  if (input.tags) body.tags = input.tags
  if (input.featured_media) body.featured_media = input.featured_media
  if (input.meta) body.meta = input.meta

  const response = await fetch(`${apiBase(creds)}/posts`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Echec de la creation de l'article WordPress (${response.status}) : ${text}`
    )
  }

  const post: WPPost = await response.json()

  return {
    wpPostId: post.id,
    wpUrl: post.link,
  }
}

/**
 * Update an existing WordPress post.
 * WordPress uses POST for updates on /posts/{id}.
 */
export async function updatePost(
  siteId: string,
  postId: number,
  input: WPUpdatePostInput
): Promise<WPPost> {
  const creds = await getWPCredentials(siteId)

  const response = await fetch(`${apiBase(creds)}/posts/${postId}`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Echec de la mise a jour de l'article ${postId} (${response.status}) : ${text}`
    )
  }

  const post: WPPost = await response.json()
  return post
}

/**
 * Upload a media file to WordPress.
 * 1. POST the binary body to /media with Content-Disposition for the filename.
 * 2. Update the media item to set alt_text.
 * Returns the new media ID and its public source URL.
 */
export async function uploadMedia(
  siteId: string,
  input: WPUploadMediaInput
): Promise<{ mediaId: number; url: string }> {
  const creds = await getWPCredentials(siteId)
  const contentType = input.mimeType ?? 'image/jpeg'

  // Step 1: upload binary
  const uploadResponse = await fetch(`${apiBase(creds)}/media`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${input.filename}"`,
    },
    body: new Uint8Array(input.buffer),
  })

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text()
    throw new Error(
      `Echec de l'upload du media "${input.filename}" (${uploadResponse.status}) : ${text}`
    )
  }

  const media: { id: number; source_url: string } = await uploadResponse.json()

  // Step 2: update alt text, title, caption
  const mediaUpdate: Record<string, string> = { alt_text: input.altText }
  if (input.title) mediaUpdate.title = input.title
  if (input.caption) mediaUpdate.caption = input.caption

  const updateResponse = await fetch(`${apiBase(creds)}/media/${media.id}`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mediaUpdate),
  })

  if (!updateResponse.ok) {
    const text = await updateResponse.text()
    throw new Error(
      `Echec de la mise a jour du texte alternatif pour le media ${media.id} (${updateResponse.status}) : ${text}`
    )
  }

  return {
    mediaId: media.id,
    url: media.source_url,
  }
}

/**
 * Fetch all published posts from WordPress (titles + slugs only).
 * Used for internal linking: provides a full sitemap of existing content.
 * Paginates up to 200 posts for performance.
 */
export async function getAllPublishedPosts(
  siteId: string
): Promise<{ id: number; title: string; slug: string; link: string }[]> {
  const creds = await getWPCredentials(siteId)
  const posts: { id: number; title: string; slug: string; link: string }[] = []

  for (let page = 1; page <= 2; page++) {
    const response = await fetch(
      `${apiBase(creds)}/posts?per_page=100&page=${page}&status=publish&_fields=id,title,slug,link`,
      {
        method: 'GET',
        headers: {
          Authorization: buildAuthHeader(creds),
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!response.ok) break

    const data: { id: number; title: { rendered: string }; slug: string; link: string }[] = await response.json()
    if (data.length === 0) break

    for (const p of data) {
      posts.push({
        id: p.id,
        title: p.title.rendered.replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&#8211;/g, '-'),
        slug: p.slug,
        link: p.link,
      })
    }

    // If less than 100, no more pages
    if (data.length < 100) break
  }

  return posts
}

/**
 * Fetch a single post by its WordPress ID, including full content.
 */
export async function getPostById(
  siteId: string,
  postId: number
): Promise<{ id: number; title: string; content: string; link: string }> {
  const creds = await getWPCredentials(siteId)

  const response = await fetch(
    `${apiBase(creds)}/posts/${postId}?_fields=id,title,content,link`,
    {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(creds),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Echec de la recuperation du post ${postId} (${response.status}) : ${text}`
    )
  }

  const data: { id: number; title: { rendered: string }; content: { rendered: string }; link: string } = await response.json()
  return {
    id: data.id,
    title: data.title.rendered.replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&#8211;/g, '-'),
    content: data.content.rendered,
    link: data.link,
  }
}

/**
 * Retrieve all categories from the WordPress site (up to 100).
 */
export async function getCategories(siteId: string): Promise<WPCategory[]> {
  const creds = await getWPCredentials(siteId)

  const response = await fetch(`${apiBase(creds)}/categories?per_page=100`, {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Echec de la recuperation des categories (${response.status}) : ${text}`
    )
  }

  const categories: WPCategory[] = await response.json()
  return categories
}

/**
 * Find the best matching existing category by name. Returns the category ID or null.
 * NEVER creates new categories — only selects from existing ones.
 */
export async function findBestCategory(
  siteId: string,
  categoryName: string
): Promise<number | null> {
  const existing = await getCategories(siteId)
  if (existing.length === 0) return null

  const normalized = categoryName.toLowerCase().trim()

  // Try exact name match (case-insensitive)
  const exactMatch = existing.find(c => c.name.toLowerCase().trim() === normalized)
  if (exactMatch) return exactMatch.id

  // Try slug match
  const slug = normalized
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const slugMatch = existing.find(c => c.slug === slug)
  if (slugMatch) return slugMatch.id

  // Try partial match (category name contained in input or vice versa)
  const partialMatch = existing.find(c => {
    const catName = c.name.toLowerCase().trim()
    return catName.includes(normalized) || normalized.includes(catName)
  })
  if (partialMatch) return partialMatch.id

  // Try word overlap: pick the category with the most words in common
  const inputWords = normalized.split(/\s+/)
  let bestOverlap = 0
  let bestCat: typeof existing[0] | null = null
  for (const cat of existing) {
    if (cat.slug === 'uncategorized' || cat.slug === 'non-classe') continue
    const catWords = cat.name.toLowerCase().split(/\s+/)
    const overlap = inputWords.filter(w => catWords.some(cw => cw.includes(w) || w.includes(cw))).length
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestCat = cat
    }
  }
  if (bestCat && bestOverlap > 0) return bestCat.id

  return null
}

/**
 * Create a new category on the WordPress site.
 */
export async function createCategory(
  siteId: string,
  name: string,
  slug: string
): Promise<WPCategory> {
  const creds = await getWPCredentials(siteId)

  const response = await fetch(`${apiBase(creds)}/categories`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, slug }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Echec de la creation de la categorie "${name}" (${response.status}) : ${text}`
    )
  }

  const category: WPCategory = await response.json()
  return category
}

/**
 * Find or create WordPress tags from a list of tag names.
 * Returns an array of WP tag IDs.
 */
export async function findOrCreateTags(
  siteId: string,
  tagNames: string[]
): Promise<number[]> {
  if (tagNames.length === 0) return []
  const creds = await getWPCredentials(siteId)
  const tagIds: number[] = []

  for (const name of tagNames.slice(0, 5)) { // Max 5 tags
    const trimmed = name.trim()
    if (!trimmed) continue

    // Search for existing tag
    const searchRes = await fetch(
      `${apiBase(creds)}/tags?search=${encodeURIComponent(trimmed)}&per_page=5`,
      {
        headers: { Authorization: buildAuthHeader(creds) },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (searchRes.ok) {
      const tags: { id: number; name: string }[] = await searchRes.json()
      const exact = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase())
      if (exact) {
        tagIds.push(exact.id)
        continue
      }
    }

    // Create new tag
    const createRes = await fetch(`${apiBase(creds)}/tags`, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(creds),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: trimmed }),
      signal: AbortSignal.timeout(5000),
    })
    if (createRes.ok) {
      const tag: { id: number } = await createRes.json()
      tagIds.push(tag.id)
    }
  }

  return tagIds
}

/**
 * Update Yoast SEO meta for a post.
 * Tries multiple approaches:
 * 1. Yoast REST API (wp-json/yoast/v1/)
 * 2. Direct post meta update via wp-json/wp/v2/posts/{id} with meta field
 * NEVER touches the slug.
 */
export async function updateYoastMeta(
  siteId: string,
  postId: number,
  seoMeta: { title?: string; description?: string }
): Promise<void> {
  const creds = await getWPCredentials(siteId)

  // Approach 1: Try Yoast's own REST API endpoint
  // Yoast Premium exposes /wp-json/yoast/v1/meta/post/{id}
  try {
    const yoastPayload: Record<string, string> = {}
    if (seoMeta.title) yoastPayload.yoast_wpseo_title = seoMeta.title
    if (seoMeta.description) yoastPayload.yoast_wpseo_metadesc = seoMeta.description

    const yoastRes = await fetch(
      `${creds.wpUrl}/wp-json/yoast/v1/meta/post/${postId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: buildAuthHeader(creds),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(yoastPayload),
        signal: AbortSignal.timeout(10000),
      }
    )

    if (yoastRes.ok) {
      console.log('[wp-client] Yoast meta updated via Yoast REST API')
      return
    }
  } catch {
    // Yoast REST API not available, try next approach
  }

  // Approach 2: Try updating via the standard WP post endpoint with yoast_meta wrapper
  // Some Yoast versions support this format
  try {
    const postPayload: Record<string, unknown> = {
      meta: {} as Record<string, string>,
    }
    const metaObj = postPayload.meta as Record<string, string>
    if (seoMeta.title) metaObj._yoast_wpseo_title = seoMeta.title
    if (seoMeta.description) metaObj._yoast_wpseo_metadesc = seoMeta.description

    // Also try Rank Math fields as fallback
    if (seoMeta.title) metaObj.rank_math_title = seoMeta.title
    if (seoMeta.description) metaObj.rank_math_description = seoMeta.description

    await fetch(`${apiBase(creds)}/posts/${postId}`, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(creds),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postPayload),
      signal: AbortSignal.timeout(10000),
    })
    // Don't check response - this is best-effort
    console.log('[wp-client] Yoast meta update attempted via standard WP REST API')
  } catch {
    // Best effort - non-critical
  }
}

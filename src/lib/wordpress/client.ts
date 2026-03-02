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

  // Step 2: update alt text
  const updateResponse = await fetch(`${apiBase(creds)}/media/${media.id}`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ alt_text: input.altText }),
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
): Promise<{ title: string; slug: string; link: string }[]> {
  const creds = await getWPCredentials(siteId)
  const posts: { title: string; slug: string; link: string }[] = []

  for (let page = 1; page <= 2; page++) {
    const response = await fetch(
      `${apiBase(creds)}/posts?per_page=100&page=${page}&status=publish&_fields=id,title,slug,link`,
      {
        method: 'GET',
        headers: {
          Authorization: buildAuthHeader(creds),
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) break

    const data: { title: { rendered: string }; slug: string; link: string }[] = await response.json()
    if (data.length === 0) break

    for (const p of data) {
      posts.push({
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
 * @deprecated Use findBestCategory instead. Kept for backward compatibility.
 */
export async function findOrCreateCategory(
  siteId: string,
  categoryName: string
): Promise<number> {
  const found = await findBestCategory(siteId, categoryName)
  if (found) return found
  // Fallback: create new (legacy behavior)
  const normalizedSlug = categoryName.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const newCat = await createCategory(siteId, categoryName, normalizedSlug)
  return newCat.id
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

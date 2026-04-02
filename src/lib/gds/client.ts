/**
 * GDS Client — GestionnaireDeSite REST API
 * Connexion au gestionnaire de site statique via JWT.
 * Aucun lien avec le client WordPress existant.
 */

export interface GdsArticlePayload {
  title: string
  titleHTML?: string
  metaDescription: string
  category: string
  author: 'mathilde' | 'elise'
  date: string
  heroImage: string
  heroAlt: string
  tags: string[]
  bodyHTML: string
  status: 'draft' | 'published'
}

export interface GdsArticleResult {
  slug: string
  article: {
    slug: string
    title: string
    status: string
  }
}

export interface GdsMediaResult {
  url: string       // ex: /site-images/mon-image.webp
  filename: string
}

/**
 * Crée un article sur GestionnaireDeSite via POST /api/blog/create
 */
export async function gdsCreateArticle(
  gdsUrl: string,
  apiToken: string,
  payload: GdsArticlePayload
): Promise<GdsArticleResult> {
  const url = `${gdsUrl.replace(/\/$/, '')}/api/blog/create`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GDS create article failed (${res.status}): ${text}`)
  }

  return res.json()
}

/**
 * Met à jour un article existant sur GestionnaireDeSite via PUT /api/blog/:slug
 */
export async function gdsUpdateArticle(
  gdsUrl: string,
  apiToken: string,
  slug: string,
  payload: Partial<GdsArticlePayload>
): Promise<GdsArticleResult> {
  const url = `${gdsUrl.replace(/\/$/, '')}/api/blog/${slug}`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GDS update article failed (${res.status}): ${text}`)
  }

  return res.json()
}

/**
 * Upload une image vers GestionnaireDeSite via POST /api/media/upload
 * Retourne le chemin /site-images/xxx.webp
 */
export async function gdsUploadImage(
  gdsUrl: string,
  apiToken: string,
  imageBuffer: Buffer,
  filename: string,
  mimeType = 'image/webp'
): Promise<GdsMediaResult> {
  const url = `${gdsUrl.replace(/\/$/, '')}/api/media/upload`

  const form = new FormData()
  const blob = new Blob([imageBuffer], { type: mimeType })
  form.append('file', blob, filename)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GDS upload image failed (${res.status}): ${text}`)
  }

  const data = await res.json()

  // GDS renvoie { url, webp, ... } — on prend le chemin webp ou url
  const imagePath: string = data.webp || data.url || data.path || ''
  if (!imagePath) throw new Error('GDS upload: chemin image absent dans la réponse')

  return {
    url: imagePath,
    filename,
  }
}

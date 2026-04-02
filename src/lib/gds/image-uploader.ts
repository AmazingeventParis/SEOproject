/**
 * GDS Image Uploader
 * Télécharge une image depuis une URL externe (ex: Fal.ai),
 * la redimensionne pour GDS (hero: 1300×488, section: max 1200px),
 * puis l'uploade vers /api/media/upload du GestionnaireDeSite.
 *
 * Indépendant du uploader WordPress existant.
 */

import sharp from 'sharp'
import { gdsUploadImage } from './client'

const HERO_WIDTH = 1300
const HERO_HEIGHT = 488   // ratio 16:6 imposé par GDS
const SECTION_MAX_WIDTH = 1200
const WEBP_QUALITY = 80

/**
 * Construit un nom de fichier SEO propre
 */
function buildSeoFilename(keyword: string, suffix: string): string {
  const base = keyword
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${base}-${suffix}.webp`
}

/**
 * Télécharge une image depuis une URL et retourne un Buffer
 */
async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Impossible de télécharger l'image: ${res.status} ${imageUrl}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Uploade l'image hero (1300×488px) vers GDS
 * Returns: chemin GDS ex: /site-images/xxx.webp
 */
export async function uploadHeroImageToGds(
  gdsUrl: string,
  apiToken: string,
  imageUrl: string,
  keyword: string
): Promise<string> {
  const rawBuffer = await fetchImageBuffer(imageUrl)

  const optimizedBuffer = await sharp(rawBuffer)
    .resize(HERO_WIDTH, HERO_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()

  const filename = buildSeoFilename(keyword, 'hero')
  const result = await gdsUploadImage(gdsUrl, apiToken, optimizedBuffer, filename)
  return result.url
}

/**
 * Uploade une image de section (max 1200px) vers GDS
 * Returns: chemin GDS ex: /site-images/xxx.webp
 */
export async function uploadSectionImageToGds(
  gdsUrl: string,
  apiToken: string,
  imageUrl: string,
  keyword: string,
  index: number
): Promise<string> {
  const rawBuffer = await fetchImageBuffer(imageUrl)

  const optimizedBuffer = await sharp(rawBuffer)
    .resize(SECTION_MAX_WIDTH, undefined, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()

  const filename = buildSeoFilename(keyword, `section-${index}`)
  const result = await gdsUploadImage(gdsUrl, apiToken, optimizedBuffer, filename)
  return result.url
}

/**
 * GDS Publisher — Publication vers GestionnaireDeSite
 * Point d'entrée principal. Orchestre:
 *   1. Upload de l'image hero vers GDS (redimensionnée 1300×488)
 *   2. Assemblage du bodyHTML depuis les content_blocks
 *   3. POST /api/blog/create (ou PUT /api/blog/:slug si déjà publié)
 *
 * N'interfère en aucun cas avec le publisher WordPress existant.
 */

import type { ContentBlock } from '@/lib/supabase/types'
import { gdsCreateArticle, gdsUpdateArticle } from './client'
import { uploadHeroImageToGds } from './image-uploader'
import {
  assembleBodyHtml,
  mapCategoryToGds,
  mapPersonaToGdsAuthor,
} from './html-assembler'

export interface GdsSiteConfig {
  gdsUrl: string
  apiToken: string
  gdsAuthor: string
  categoryMap: Record<string, string>
  siteDomain?: string
}

export interface GdsPublishInput {
  articleId: string
  title: string
  slug: string
  metaDescription: string | null
  keyword: string
  category: string | null
  personaName: string | null
  date: string
  tags: string[]
  contentBlocks: ContentBlock[]
  heroImageUrl: string | null      // URL Fal.ai ou WordPress existant
  jsonLd: Record<string, unknown> | null
  existingGdsSlug: string | null   // si l'article a déjà été publié sur GDS
  siteConfig: GdsSiteConfig
}

export interface GdsPublishResult {
  success: boolean
  gdsSlug: string
  gdsUrl: string
  heroGdsPath: string
  error?: string
}

export async function publishToGds(input: GdsPublishInput): Promise<GdsPublishResult> {
  const {
    title,
    slug,
    metaDescription,
    keyword,
    category,
    personaName,
    date,
    tags,
    contentBlocks,
    heroImageUrl,
    existingGdsSlug,
    siteConfig,
  } = input

  const { gdsUrl, apiToken, gdsAuthor, categoryMap, siteDomain } = siteConfig

  // 1. Upload hero image vers GDS (format 1300×488)
  let heroGdsPath = ''
  if (heroImageUrl) {
    try {
      heroGdsPath = await uploadHeroImageToGds(gdsUrl, apiToken, heroImageUrl, keyword)
    } catch (err) {
      console.warn('[gds/publisher] Hero image upload failed (non-blocking):', err)
      // On continue sans image — GDS affichera un placeholder
    }
  }

  // 2. Assemble le bodyHTML depuis les blocs
  const bodyHTML = assembleBodyHtml(contentBlocks, { siteDomain })

  // 3. Mappe catégorie et auteur vers les valeurs GDS
  const gdsCategory = mapCategoryToGds(category, categoryMap)
  const gdsAuthorKey = mapPersonaToGdsAuthor(personaName, gdsAuthor)

  // 4. Construit le payload GDS
  const articleDate = date || new Date().toISOString().split('T')[0]
  const gdsSlug = `blog-${slug.replace(/^blog-/, '')}`

  const payload = {
    title,
    metaDescription: metaDescription || '',
    category: gdsCategory,
    author: gdsAuthorKey,
    date: articleDate,
    heroImage: heroGdsPath,
    heroAlt: title,
    tags,
    bodyHTML,
    status: 'published' as const,
  }

  // 5. Crée ou met à jour l'article sur GDS
  let result
  if (existingGdsSlug) {
    result = await gdsUpdateArticle(gdsUrl, apiToken, existingGdsSlug, payload)
  } else {
    result = await gdsCreateArticle(gdsUrl, apiToken, payload)
  }

  const finalSlug = result.slug || gdsSlug
  const gdsArticleUrl = `${gdsUrl.replace(/\/$/, '')}/blog/${finalSlug.replace(/^blog-/, '')}/`

  return {
    success: true,
    gdsSlug: finalSlug,
    gdsUrl: gdsArticleUrl,
    heroGdsPath,
  }
}

// ============================================================
// Revamp Generator — Orchestrate content regeneration
// Takes audit plan and produces new content blocks
// ============================================================

import { getServerClient } from '@/lib/supabase/client'
import { executeStep } from '@/lib/pipeline/orchestrator'
import type { ContentBlock } from '@/lib/supabase/types'
import type { RevampAudit } from './types'
import type { PipelineRunResult } from '@/lib/pipeline/types'

/**
 * Build the new content_blocks array from the audit plan.
 * Merges: kept blocks + rewrite placeholders + new section placeholders.
 */
export function buildRevampBlocks(
  originalBlocks: ContentBlock[],
  audit: RevampAudit,
): ContentBlock[] {
  const newBlocks: ContentBlock[] = []

  // Track which original blocks are referenced
  const keptIndices = new Set(audit.blocksToKeep.map(b => b.blockIndex))
  const rewriteIndices = new Map(
    audit.blocksToRewrite.map(b => [b.blockIndex, b])
  )
  const deleteIndices = new Set(audit.blocksToDelete.map(b => b.blockIndex))

  // First, process original blocks in order
  for (let i = 0; i < originalBlocks.length; i++) {
    const original = originalBlocks[i]

    if (deleteIndices.has(i)) {
      // Skip deleted blocks
      continue
    }

    if (keptIndices.has(i)) {
      // Keep as-is (already written)
      newBlocks.push({ ...original, status: 'written' })
    } else if (rewriteIndices.has(i)) {
      // Mark for rewrite (pending with directive)
      const rewrite = rewriteIndices.get(i)!
      newBlocks.push({
        ...original,
        status: 'pending',
        writing_directive: rewrite.directive,
        content_html: '', // Clear for rewrite
      })
    } else {
      // Default: keep
      newBlocks.push({ ...original, status: 'written' })
    }

    // Check if new sections should be inserted after this original index
    const inserts = audit.newSectionsToAdd
      .filter(s => s.insertAfterIndex === i)
      .sort((a, b) => audit.newSectionsToAdd.indexOf(a) - audit.newSectionsToAdd.indexOf(b))

    for (const section of inserts) {
      newBlocks.push({
        id: crypto.randomUUID(),
        type: section.type,
        heading: section.heading,
        content_html: '',
        nugget_ids: [],
        word_count: 0,
        status: 'pending',
        writing_directive: section.directive,
        key_ideas: section.keyIdeas,
      })
    }
  }

  // Add sections with insertAfterIndex = -1 at the end
  const endSections = audit.newSectionsToAdd.filter(s => s.insertAfterIndex === -1)
  for (const section of endSections) {
    newBlocks.push({
      id: crypto.randomUUID(),
      type: section.type,
      heading: section.heading,
      content_html: '',
      nugget_ids: [],
      word_count: 0,
      status: 'pending',
      writing_directive: section.directive,
      key_ideas: section.keyIdeas,
    })
  }

  return newBlocks
}

/**
 * Generate content for all pending blocks in a revamp project.
 * Uses the existing pipeline's write_block step.
 * Must have an article_id in the DB to use executeStep.
 */
export async function generateRevampContent(
  revampId: string,
): Promise<{ written: number; errors: number }> {
  const supabase = getServerClient()

  // Fetch revamp project
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('*')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    throw new Error(`Revamp project non trouve: ${revampId}`)
  }

  if (!revamp.article_id) {
    throw new Error('article_id requis pour generer du contenu. Creez d\'abord un article lie.')
  }

  const newBlocks = (revamp.new_blocks || []) as ContentBlock[]
  const pendingIndices: number[] = []

  for (let i = 0; i < newBlocks.length; i++) {
    if (newBlocks[i].status === 'pending') pendingIndices.push(i)
  }

  if (pendingIndices.length === 0) {
    return { written: 0, errors: 0 }
  }

  // Update revamp status
  await supabase
    .from('seo_revamps')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', revampId)

  // Update article content_blocks to use as pipeline source
  await supabase
    .from('seo_articles')
    .update({ content_blocks: newBlocks })
    .eq('id', revamp.article_id)

  let written = 0
  let errors = 0
  const usedNuggetIds: string[] = []

  for (const blockIndex of pendingIndices) {
    try {
      const result: PipelineRunResult = await executeStep(
        revamp.article_id,
        'write_block',
        { blockIndex, usedNuggetIds }
      )

      if (result.success) {
        written++
        const nuggetIds = (result.output?.nuggetIdsUsed as string[]) || []
        usedNuggetIds.push(...nuggetIds)
      } else {
        errors++
      }
    } catch {
      errors++
    }
  }

  // Re-fetch the article to get updated blocks
  const { data: updatedArticle } = await supabase
    .from('seo_articles')
    .select('content_blocks, content_html')
    .eq('id', revamp.article_id)
    .single()

  const finalBlocks = (updatedArticle?.content_blocks || newBlocks) as ContentBlock[]

  // Assemble HTML from blocks if content_html is missing
  let finalHtml = updatedArticle?.content_html || null
  if (!finalHtml && finalBlocks.length > 0) {
    const parts: string[] = []
    let first = true
    for (const b of finalBlocks.filter(bl => bl.status === 'written' && bl.content_html)) {
      const tag = b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'
      if (b.heading && !first) {
        parts.push('<div style="margin-top:50px" aria-hidden="true"></div>')
      }
      const heading = b.heading ? `<${tag}>${b.heading}</${tag}>\n` : ''
      parts.push(heading + b.content_html)
      first = false
    }
    finalHtml = parts.join('\n\n')
  }

  // Update revamp with new blocks
  await supabase
    .from('seo_revamps')
    .update({
      new_blocks: finalBlocks,
      new_content_html: finalHtml,
      status: errors === 0 ? 'generated' : (written > 0 ? 'generated' : 'failed'),
      error: errors > 0 ? `${errors} bloc(s) en erreur` : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', revampId)

  return { written, errors }
}

/**
 * Push revamp content to WordPress.
 * Updates the existing WP post with new content.
 */
export async function pushToWordPress(
  revampId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = getServerClient()

  const { data: revamp } = await supabase
    .from('seo_revamps')
    .select('*, seo_sites!seo_revamps_site_id_fkey(domain)')
    .eq('id', revampId)
    .single()

  if (!revamp) {
    return { success: false, error: 'Revamp non trouve' }
  }

  // Assemble HTML from blocks if not already done
  let contentHtml = revamp.new_content_html as string | null
  if (!contentHtml) {
    const blocks = (revamp.new_blocks || []) as ContentBlock[]
    const writtenBlocks = blocks.filter(b => b.status === 'written' && b.content_html)
    if (writtenBlocks.length === 0) {
      return { success: false, error: 'Aucun contenu genere' }
    }
    const htmlParts: string[] = []
    let isFirst = true
    for (const b of writtenBlocks) {
      const tag = b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'
      // Add spacing before heading sections (not before the first block)
      if (b.heading && !isFirst) {
        htmlParts.push('<div style="margin-top:50px" aria-hidden="true"></div>')
      }
      const heading = b.heading ? `<${tag}>${b.heading}</${tag}>\n` : ''
      htmlParts.push(heading + b.content_html)
      isFirst = false
    }
    contentHtml = htmlParts.join('\n\n')

    // Save assembled HTML
    await supabase
      .from('seo_revamps')
      .update({ new_content_html: contentHtml })
      .eq('id', revampId)
  }

  // Clean up any Gutenberg spacer blocks — they render full-width on Elementor themes
  // Replace with simple CSS margin divs
  contentHtml = contentHtml
    .replace(/<!--\s*wp:spacer[\s\S]*?<!--\s*\/wp:spacer\s*-->/gi, '<div style="margin-top:50px" aria-hidden="true"></div>')
    .replace(/<div[^>]*class="wp-block-spacer"[^>]*><\/div>/gi, '')

  // Strip Elementor widget wrapper divs from content (kept blocks may contain old Elementor markup)
  // These wrappers break layout when Elementor edit mode is disabled
  contentHtml = stripElementorWrappers(contentHtml)

  // Fix expert callout avatars: replace letter fallback with persona image
  if (contentHtml.includes('expert-callout')) {
    const personaId = revamp.article_id
      ? (await supabase.from('seo_articles').select('persona_id').eq('id', revamp.article_id).single()).data?.persona_id
      : null
    if (personaId) {
      const { data: persona } = await supabase
        .from('seo_personas')
        .select('name, avatar_reference_url')
        .eq('id', personaId)
        .single()
      if (persona?.avatar_reference_url) {
        contentHtml = fixCalloutAvatars(contentHtml, persona.avatar_reference_url, persona.name)
      }
    }
  }

  // Import WordPress client
  const { updatePost } = await import('@/lib/wordpress/client')

  try {
    // Build update payload
    const updatePayload: Record<string, unknown> = {
      content: contentHtml,
      status: 'publish', // Ensure post stays published (Elementor clearing can revert to draft)
    }

    // Update title (H1) if audit suggests one
    const audit = revamp.audit as RevampAudit | null
    if (audit?.suggestedTitle) {
      updatePayload.title = audit.suggestedTitle
    }

    // Update SEO meta via Yoast/RankMath (title + description)
    // NEVER touch the slug
    const meta: Record<string, string> = {}
    if (audit?.suggestedTitle) {
      meta._yoast_wpseo_title = audit.suggestedTitle
      meta.rank_math_title = audit.suggestedTitle
    }
    if (audit?.suggestedMetaDescription) {
      meta._yoast_wpseo_metadesc = audit.suggestedMetaDescription
      meta.rank_math_description = audit.suggestedMetaDescription
    }

    // For Elementor posts: disable Elementor so WP uses the standard content field
    // This converts the page from Elementor to classic/Gutenberg editor
    const pageBuilder = revamp.page_builder as string
    if (pageBuilder === 'elementor') {
      meta._elementor_edit_mode = ''        // Disable Elementor edit mode
      meta._elementor_data = '[]'           // Clear Elementor widget data
      meta._elementor_page_settings = '[]'  // Clear page settings
      meta._wp_page_template = 'default'    // Reset to default blog template (not full-width/canvas)
    }

    // Always ensure the page template is the default blog template
    // Elementor often sets templates like elementor_header_footer or elementor_canvas
    // which display content full-width without the blog sidebar/container
    if (!meta._wp_page_template) {
      meta._wp_page_template = 'default'
    }

    if (Object.keys(meta).length > 0) {
      updatePayload.meta = meta
    }

    await updatePost(revamp.site_id, revamp.wp_post_id, updatePayload)

    // Try updating Yoast SEO meta via Yoast's own REST API (fallback for sites where
    // _yoast_wpseo_title is not registered with show_in_rest)
    if (audit?.suggestedTitle || audit?.suggestedMetaDescription) {
      try {
        const { updateYoastMeta } = await import('@/lib/wordpress/client')
        await updateYoastMeta(revamp.site_id, revamp.wp_post_id, {
          title: audit?.suggestedTitle || undefined,
          description: audit?.suggestedMetaDescription || undefined,
        })
      } catch (yoastErr) {
        // Non-critical: log but don't fail the push
        console.warn('[revamp-push] Yoast meta update failed (non-critical):', yoastErr)
      }
    }

    // Update revamp status
    await supabase
      .from('seo_revamps')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', revampId)

    // Also update the linked article to 'published' so CTR optimization etc. are available
    if (revamp.article_id) {
      await supabase
        .from('seo_articles')
        .update({
          status: 'published',
          content_html: contentHtml,
          seo_title: audit?.suggestedTitle || undefined,
          meta_description: audit?.suggestedMetaDescription || undefined,
        })
        .eq('id', revamp.article_id)
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    await supabase
      .from('seo_revamps')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', revampId)

    return { success: false, error: message }
  }
}

/**
 * Strip Elementor widget wrapper divs from HTML content.
 * Kept blocks from the original post may contain Elementor markup like:
 *   <div class="elementor-element ..."><div class="elementor-widget-container">...actual content...</div></div>
 * These wrappers break layout when Elementor edit mode is disabled.
 */
function stripElementorWrappers(html: string): string {
  let cleaned = html

  // 1. Remove entire Elementor CTA/button blocks (e-con-inner with button wrappers)
  cleaned = cleaned.replace(/<div[^>]*class="e-con-inner"[^>]*>[\s\S]*?<\/span>\s*<\/a>\s*<\/div>\s*<\/div>\s*<\/div>/gi, '')

  // 2. Remove opening elementor-element/widget/section divs (with all attributes)
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-(?:element|widget-wrap|section-wrap|container)[^"]*"[^>]*>\s*/gi, '')

  // 3. Remove opening elementor-widget-container divs
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor-widget-container[^"]*"[^>]*>\s*/gi, '')

  // 4. Remove any remaining divs with elementor classes
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*elementor[^"]*"[^>]*>/gi, '')

  // 5. Remove Elementor data attributes from any remaining elements
  cleaned = cleaned.replace(/\s*data-(?:id|element_type|e-type|widget_type|settings)="[^"]*"/gi, '')

  // 6. Remove empty divs
  cleaned = cleaned.replace(/<div[^>]*>\s*<\/div>\s*/g, '')

  // 7. Balance div tags — remove orphan </div> that have no matching opening tag
  // Parse sequentially tracking div depth
  const chars = cleaned
  let output = ''
  let i = 0
  let divStack = 0

  while (i < chars.length) {
    // Check for opening div
    if (chars.slice(i, i + 4) === '<div') {
      const end = chars.indexOf('>', i)
      if (end !== -1) {
        output += chars.slice(i, end + 1)
        divStack++
        i = end + 1
        continue
      }
    }

    // Check for closing div
    if (chars.slice(i, i + 6) === '</div>') {
      if (divStack > 0) {
        output += '</div>'
        divStack--
      }
      // Skip orphan closing div
      i += 6
      continue
    }

    output += chars[i]
    i++
  }

  return output.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Fix expert callout avatars: replace letter-circle fallback with actual persona image.
 * AI often generates the letter fallback even when given the <img> template.
 */
function fixCalloutAvatars(html: string, avatarUrl: string, personaName: string): string {
  // Match the letter-circle div pattern (52x52px circle with single letter)
  return html.replace(
    /<div\s+style="[^"]*width:52px;height:52px;border-radius:50%[^"]*display:flex;align-items:center;justify-content:center[^"]*">[A-ZÀ-Ú]<\/div>/gi,
    `<img src="${avatarUrl}" alt="${personaName}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid #0A6CFF" />`
  )
}

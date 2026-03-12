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
    finalHtml = finalBlocks
      .filter(b => b.status === 'written' && b.content_html)
      .map(b => {
        const heading = b.heading
          ? `<${b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'}>${b.heading}</${b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'}>\n`
          : ''
        return heading + b.content_html
      })
      .join('\n\n')
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
    contentHtml = writtenBlocks
      .map(b => {
        const tag = b.type === 'h3' ? 'h3' : b.type === 'h4' ? 'h4' : 'h2'
        const heading = b.heading ? `<${tag}>${b.heading}</${tag}>\n` : ''
        return heading + b.content_html
      })
      .join('\n\n')

    // Save assembled HTML
    await supabase
      .from('seo_revamps')
      .update({ new_content_html: contentHtml })
      .eq('id', revampId)
  }

  // Import WordPress client
  const { updatePost } = await import('@/lib/wordpress/client')

  try {
    // Build update payload
    const updatePayload: Record<string, unknown> = {
      content: contentHtml,
    }

    // Update title if audit suggests one
    const audit = revamp.audit as RevampAudit | null
    if (audit?.suggestedTitle) {
      updatePayload.title = audit.suggestedTitle
    }

    // Update meta description via Yoast/RankMath
    if (audit?.suggestedMetaDescription) {
      updatePayload.meta = {
        _yoast_wpseo_metadesc: audit.suggestedMetaDescription,
        rank_math_description: audit.suggestedMetaDescription,
      }
    }

    await updatePost(revamp.site_id, revamp.wp_post_id, updatePayload)

    // Update status
    await supabase
      .from('seo_revamps')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', revampId)

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

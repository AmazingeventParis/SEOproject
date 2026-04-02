import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/client'
import { analyzePost } from '@/lib/revamp/identifier'
import { compareWithSERP } from '@/lib/revamp/comparator'
import { auditContent } from '@/lib/revamp/auditor'
import { extractMainKeyword } from '@/lib/pipeline/html-parser'
import { buildRevampBlocks } from '@/lib/revamp/generator'

export const maxDuration = 120 // 2 minutes for full analysis

const analyzeSchema = z.object({
  siteId: z.string().uuid(),
  wpPostId: z.number().int().positive(),
  keyword: z.string().optional(),
})

/**
 * POST /api/revamp/analyze
 * Analyze a WordPress post for revamp: GSC + SERP comparison + AI audit.
 * Creates a seo_revamps row and returns the full analysis.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Corps de requete invalide' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const parsed = analyzeSchema.safeParse(body)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Validation echouee', details: parsed.error.format() }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { siteId, wpPostId, keyword: providedKeyword } = parsed.data
  const supabase = getServerClient()

  // Get site with GSC property
  const { data: site } = await supabase
    .from('seo_sites')
    .select('id, domain, gsc_property')
    .eq('id', siteId)
    .single()

  if (!site) {
    return new Response(
      JSON.stringify({ error: 'Site non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!site.gsc_property) {
    return new Response(
      JSON.stringify({ error: 'GSC non configure pour ce site' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Step 1: Analyze the WP post (GSC + content parsing)
    const analysis = await analyzePost(siteId, wpPostId, site.gsc_property)

    // Determine keyword
    const wpPost = await (await import('@/lib/wordpress/client')).getPostById(siteId, wpPostId)
    const keyword = providedKeyword || extractMainKeyword(wpPost.title)

    // Step 2: Compare with SERP
    const serpComparison = await compareWithSERP(keyword, analysis.originalBlocks, analysis.gscData)

    // Step 3: AI Audit
    const audit = await auditContent(
      keyword,
      wpPost.title,
      analysis.originalBlocks,
      analysis.gscData,
      serpComparison,
      analysis.preservedLinks,
      analysis.preservedCTAs,
    )

    // Step 4: Build new blocks from audit
    const newBlocks = buildRevampBlocks(analysis.originalBlocks, audit)

    // Check if there's already an article for this wp_post_id
    const { data: existingArticle } = await supabase
      .from('seo_articles')
      .select('id')
      .eq('wp_post_id', wpPostId)
      .eq('site_id', siteId)
      .single()

    // Create revamp project
    const { data: revamp, error: insertError } = await supabase
      .from('seo_revamps')
      .insert({
        site_id: siteId,
        article_id: existingArticle?.id || null,
        wp_post_id: wpPostId,
        wp_url: wpPost.link,
        original_title: wpPost.title,
        original_keyword: keyword,
        page_builder: analysis.pageBuilder as 'gutenberg' | 'elementor' | 'unknown',
        status: 'analyzed' as const,
        gsc_data: analysis.gscData as unknown as Record<string, unknown>,
        serp_comparison: serpComparison as unknown as Record<string, unknown>,
        audit: audit as unknown as Record<string, unknown>,
        original_blocks: analysis.originalBlocks,
        new_blocks: newBlocks,
        preserved_links: analysis.preservedLinks as unknown as Record<string, unknown>[],
        preserved_ctas: analysis.preservedCTAs,
      })
      .select()
      .single()

    if (insertError) {
      throw new Error(`Erreur DB: ${insertError.message}`)
    }

    return new Response(
      JSON.stringify({ revamp }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

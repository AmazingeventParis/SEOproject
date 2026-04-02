import { NextRequest } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'
import type { RevampLinkSuggestions } from '@/lib/revamp/types'

interface RouteContext {
  params: { revampId: string }
}

/**
 * POST /api/revamp/[revampId]/select-links
 * Save user's link selections (authority + internal).
 * Body: {
 *   authorityIndex?: number,           // index in suggestions array
 *   customAuthority?: { url: string, title: string, anchor_context: string },
 *   selectedInternalIndices?: number[], // indices in suggestions array
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  const supabase = getServerClient()
  const { revampId } = params

  // Fetch revamp
  const { data: revamp, error } = await supabase
    .from('seo_revamps')
    .select('id, link_suggestions')
    .eq('id', revampId)
    .single()

  if (error || !revamp) {
    return new Response(
      JSON.stringify({ error: 'Revamp non trouve' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const linkSuggestions = revamp.link_suggestions as RevampLinkSuggestions | null
  if (!linkSuggestions) {
    return new Response(
      JSON.stringify({ error: 'Aucune suggestion de liens generee. Lancez d\'abord la suggestion.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: {
    authorityIndex?: number
    customAuthority?: { url: string; title: string; anchor_context: string }
    selectedInternalIndices?: number[]
  }

  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body JSON invalide' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Update authority link selection
  if (body.authorityIndex !== undefined && body.authorityIndex >= 0) {
    const idx = body.authorityIndex
    if (idx < linkSuggestions.authority.length) {
      // Mark selected
      linkSuggestions.authority.forEach((a, i) => { a.selected = i === idx })
      const selected = linkSuggestions.authority[idx]
      linkSuggestions.selectedAuthority = {
        url: selected.url,
        title: selected.title,
        anchor_context: selected.rationale,
      }
    }
  } else if (body.customAuthority) {
    // Custom authority link — HEAD-check first
    try {
      const res = await fetch(body.customAuthority.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      })
      if (res.status < 200 || res.status >= 400) {
        return new Response(
          JSON.stringify({ error: `URL invalide (HTTP ${res.status})` }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        )
      }
    } catch {
      return new Response(
        JSON.stringify({ error: 'URL inaccessible' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    linkSuggestions.authority.forEach(a => { a.selected = false })
    linkSuggestions.selectedAuthority = {
      url: body.customAuthority.url,
      title: body.customAuthority.title,
      anchor_context: body.customAuthority.anchor_context,
    }
    linkSuggestions.customAuthorityUrl = body.customAuthority.url
  } else if (body.authorityIndex === -1) {
    // Deselect authority
    linkSuggestions.authority.forEach(a => { a.selected = false })
    linkSuggestions.selectedAuthority = null
  }

  // Update internal link selections
  if (body.selectedInternalIndices !== undefined) {
    const selectedSet = new Set(body.selectedInternalIndices)
    linkSuggestions.internal.forEach((link, i) => {
      link.selected = selectedSet.has(i)
    })
  }

  // Save
  await supabase
    .from('seo_revamps')
    .update({
      link_suggestions: linkSuggestions as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', revampId)

  return new Response(
    JSON.stringify({ success: true, linkSuggestions }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

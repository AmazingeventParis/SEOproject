import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'

interface RouteContext {
  params: { articleId: string }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = getServerClient()

  let body: { article_angle?: string; writing_directives?: Record<string, unknown>[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.article_angle !== undefined) update.article_angle = body.article_angle || null
  if (body.writing_directives !== undefined) update.writing_directives = body.writing_directives

  const { data, error } = await supabase
    .from('seo_articles')
    .update(update)
    .eq('id', params.articleId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

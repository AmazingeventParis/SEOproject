import { NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/client'

// GET /api/migrate/editorial — One-time migration for editorial features
// Adds columns: seo_sites.editorial_angle, seo_articles.article_angle, seo_articles.writing_directives
export async function GET() {
  const supabase = getServerClient()

  const results: string[] = []

  // Test if columns exist by trying to select them
  const { error: e1 } = await supabase.from('seo_sites').select('editorial_angle').limit(1)
  if (e1 && e1.message.includes('editorial_angle')) {
    // Column doesn't exist — add it via raw insert trick
    // Since Supabase JS doesn't support DDL, we use the rpc approach
    results.push('seo_sites.editorial_angle: NEEDS MANUAL MIGRATION')
  } else {
    results.push('seo_sites.editorial_angle: OK (exists)')
  }

  const { error: e2 } = await supabase.from('seo_articles').select('article_angle').limit(1)
  if (e2 && e2.message.includes('article_angle')) {
    results.push('seo_articles.article_angle: NEEDS MANUAL MIGRATION')
  } else {
    results.push('seo_articles.article_angle: OK (exists)')
  }

  const { error: e3 } = await supabase.from('seo_articles').select('writing_directives').limit(1)
  if (e3 && e3.message.includes('writing_directives')) {
    results.push('seo_articles.writing_directives: NEEDS MANUAL MIGRATION')
  } else {
    results.push('seo_articles.writing_directives: OK (exists)')
  }

  const needsMigration = results.some(r => r.includes('NEEDS'))

  return NextResponse.json({
    status: needsMigration ? 'migration_needed' : 'ok',
    results,
    sql: needsMigration ? `
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor):
ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS editorial_angle jsonb DEFAULT NULL;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS article_angle text DEFAULT NULL;
ALTER TABLE seo_articles ADD COLUMN IF NOT EXISTS writing_directives jsonb DEFAULT NULL;
    `.trim() : null,
  })
}

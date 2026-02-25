import type { ArticleStatus } from '@/lib/supabase/types'

export type PipelineStep =
  | 'analyze'
  | 'plan'
  | 'write_block'
  | 'media'
  | 'seo'
  | 'publish'
  | 'refresh'

export interface PipelineTransition {
  from: ArticleStatus
  to: ArticleStatus
  step: PipelineStep
  guard?: (context: PipelineContext) => boolean | string
}

export interface PipelineContext {
  articleId: string
  siteId: string
  keyword: string
  personaId?: string | null
  siloId?: string | null
  nuggetDensityScore?: number
  contentBlocksCount?: number
  writtenBlocksCount?: number
}

export interface PipelineRunInput {
  articleId: string
  step: PipelineStep
  input?: Record<string, unknown>
}

export interface PipelineRunResult {
  success: boolean
  runId: string
  output?: Record<string, unknown>
  error?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  durationMs?: number
  modelUsed?: string
}

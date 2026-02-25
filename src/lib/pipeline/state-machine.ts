import type { ArticleStatus } from '@/lib/supabase/types'
import type { PipelineStep, PipelineTransition, PipelineContext } from './types'

// All valid state transitions in the article pipeline
const TRANSITIONS: PipelineTransition[] = [
  // Draft -> Analyzing (run SERP + cannibalization check)
  {
    from: 'draft',
    to: 'analyzing',
    step: 'analyze',
  },
  // Analyzing -> Planning (generate article plan)
  {
    from: 'analyzing',
    to: 'planning',
    step: 'plan',
  },
  // Planning -> Writing (write content blocks)
  {
    from: 'planning',
    to: 'writing',
    step: 'write_block',
    guard: (ctx) => {
      if (!ctx.personaId) return 'Un persona doit etre assigne avant la redaction'
      return true
    },
  },
  // Writing -> Writing (write additional blocks - stays in writing)
  {
    from: 'writing',
    to: 'writing',
    step: 'write_block',
  },
  // Writing -> Media (generate images)
  {
    from: 'writing',
    to: 'media',
    step: 'media',
    guard: (ctx) => {
      if (ctx.contentBlocksCount && ctx.writtenBlocksCount && ctx.writtenBlocksCount < ctx.contentBlocksCount) {
        return `Tous les blocs doivent etre ecrits (${ctx.writtenBlocksCount}/${ctx.contentBlocksCount})`
      }
      return true
    },
  },
  // Media -> SEO Check (generate JSON-LD, meta tags)
  {
    from: 'media',
    to: 'seo_check',
    step: 'seo',
  },
  // SEO Check -> Reviewing (human review)
  {
    from: 'seo_check',
    to: 'reviewing',
    step: 'seo',
  },
  // Reviewing -> Publishing (push to WordPress)
  {
    from: 'reviewing',
    to: 'publishing',
    step: 'publish',
  },
  // Publishing -> Published (done)
  {
    from: 'publishing',
    to: 'published',
    step: 'publish',
  },
  // Published -> Refresh Needed (seasonal update)
  {
    from: 'published',
    to: 'refresh_needed',
    step: 'refresh',
  },
  // Refresh Needed -> Writing (re-enter writing for refresh)
  {
    from: 'refresh_needed',
    to: 'writing',
    step: 'write_block',
  },
  // Allow going back to draft from analyzing/planning (reset)
  {
    from: 'analyzing',
    to: 'draft',
    step: 'analyze',
  },
  {
    from: 'planning',
    to: 'draft',
    step: 'plan',
  },
]

/**
 * Get the valid next status for a given current status and step
 */
export function getNextStatus(
  currentStatus: ArticleStatus,
  step: PipelineStep
): ArticleStatus | null {
  const transition = TRANSITIONS.find(
    (t) => t.from === currentStatus && t.step === step && t.to !== currentStatus
  )
  return transition?.to ?? null
}

/**
 * Check if a transition is valid, returns true or an error message
 */
export function validateTransition(
  currentStatus: ArticleStatus,
  step: PipelineStep,
  context: PipelineContext
): true | string {
  const transition = TRANSITIONS.find(
    (t) => t.from === currentStatus && t.step === step
  )

  if (!transition) {
    return `Transition invalide: impossible d'executer "${step}" depuis le statut "${currentStatus}"`
  }

  if (transition.guard) {
    const result = transition.guard(context)
    if (typeof result === 'string') return result
  }

  return true
}

/**
 * Get all available steps for a given status
 */
export function getAvailableSteps(currentStatus: ArticleStatus): PipelineStep[] {
  return Array.from(new Set(
    TRANSITIONS.filter((t) => t.from === currentStatus).map((t) => t.step)
  ))
}

/**
 * Get the pipeline progress as a percentage
 */
export function getPipelineProgress(status: ArticleStatus): number {
  const progressMap: Record<ArticleStatus, number> = {
    draft: 0,
    analyzing: 10,
    planning: 20,
    writing: 40,
    media: 60,
    seo_check: 70,
    reviewing: 80,
    publishing: 90,
    published: 100,
    refresh_needed: 95,
  }
  return progressMap[status] ?? 0
}

/**
 * Get the human-readable French label for a status
 */
export function getStatusLabel(status: ArticleStatus): string {
  const labels: Record<ArticleStatus, string> = {
    draft: 'Brouillon',
    analyzing: 'Analyse en cours',
    planning: 'Plan en cours',
    writing: 'Redaction',
    media: 'Media',
    seo_check: 'Verification SEO',
    reviewing: 'En relecture',
    publishing: 'Publication',
    published: 'Publie',
    refresh_needed: 'Mise a jour requise',
  }
  return labels[status] ?? status
}

/**
 * Get step label in French
 */
export function getStepLabel(step: PipelineStep): string {
  const labels: Record<PipelineStep, string> = {
    analyze: 'Analyse SERP',
    plan: 'Generation du plan',
    write_block: 'Redaction',
    media: 'Generation media',
    seo: 'Optimisation SEO',
    publish: 'Publication WordPress',
    refresh: 'Rafraichissement',
  }
  return labels[step] ?? step
}

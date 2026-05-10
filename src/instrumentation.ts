// Next.js instrumentation hook — runs once at server startup.
// Used to surface "is the AI provider ready?" in Coolify boot logs so we can
// see at a glance whether the app can actually run pipelines, instead of
// finding out only when a user clicks "Lancer".

export async function register() {
  // Only run on the Node.js runtime (not edge, not during build).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Skip the boot ping during `next build` — at build time the API key may not be
  // available and we don't want builds to fail just because Anthropic is down.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { checkAnthropicCredits, pipelineEnabled } = await import('./lib/ai/preflight')

  if (!pipelineEnabled()) {
    console.warn('[boot] PIPELINE_ENABLED=false — heavy endpoints will return 503')
  }

  const result = await checkAnthropicCredits()
  if (result.ok) {
    console.log('[boot] Anthropic credits: OK')
  } else {
    console.warn(`[boot] Anthropic check FAILED — kind=${result.kind} msg=${result.message}`)
    if (result.kind === 'OUT_OF_CREDITS') {
      console.warn('[boot] >>> Pipeline launches will be blocked until credits are recharged.')
      console.warn('[boot] >>> https://console.anthropic.com/settings/plans')
    }
  }
}

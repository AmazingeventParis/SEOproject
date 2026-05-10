// Pre-flight credit check + kill switch.
// Used by pipeline-launching endpoints (queue, autopilot, write-all) and at app boot.

import { callClaude } from './claude'
import { AIError, isAIError } from './errors'

/**
 * Returns false if the operator has explicitly disabled the pipeline via env var.
 * Set PIPELINE_ENABLED=false in Coolify to halt all heavy endpoints without rebuilding.
 */
export function pipelineEnabled(): boolean {
  return process.env.PIPELINE_ENABLED !== 'false'
}

/**
 * Tiny diagnostic call to confirm Anthropic accepts requests on this account.
 * Throws an AIError(kind=OUT_OF_CREDITS) if credits are exhausted, surfacing the
 * exact reason instead of letting the pipeline fail mid-run with thousands of
 * Gemini fallback calls behind it.
 *
 * Cost: ~5 input tokens + 1 output token = ~$0.000005 (negligible).
 */
export async function assertAnthropicCreditsOk(): Promise<void> {
  await callClaude({
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: '.' }],
    maxTokens: 1,
    temperature: 0,
  })
}

/**
 * Same as assertAnthropicCreditsOk, but returns a status object instead of throwing.
 * Useful for boot-time logging where we want to report-not-fail.
 */
export async function checkAnthropicCredits(): Promise<
  | { ok: true }
  | { ok: false; kind: string; message: string }
> {
  try {
    await assertAnthropicCreditsOk()
    return { ok: true }
  } catch (err) {
    if (isAIError(err)) {
      return { ok: false, kind: err.kind, message: err.message }
    }
    return {
      ok: false,
      kind: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Standard JSON body for an "out of credits" 402 response.
 */
export function outOfCreditsResponseBody(): Record<string, string> {
  return {
    error: 'ANTHROPIC_CREDITS_EXHAUSTED',
    message:
      "Le compte Anthropic n'a plus de credits — le pipeline est coupe pour eviter de bruler du Gemini en fallback. " +
      'Recharge sur https://console.anthropic.com/settings/plans avant de relancer.',
    action: 'recharge_anthropic',
    docsUrl: 'https://console.anthropic.com/settings/plans',
  }
}

/**
 * Standard JSON body for a "pipeline disabled" 503 response.
 */
export function pipelineDisabledResponseBody(): Record<string, string> {
  return {
    error: 'PIPELINE_DISABLED',
    message:
      'Le pipeline est desactive (PIPELINE_ENABLED=false). ' +
      'Re-active dans les variables Coolify pour relancer.',
    action: 'enable_pipeline',
  }
}

/**
 * Run pipeline-launch guards: kill switch then credit check.
 * Returns null if everything is OK, or a Response to immediately return otherwise.
 */
export async function pipelinePreflight(): Promise<Response | null> {
  if (!pipelineEnabled()) {
    return new Response(JSON.stringify(pipelineDisabledResponseBody()), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    await assertAnthropicCreditsOk()
  } catch (err) {
    if (isAIError(err) && err.kind === 'OUT_OF_CREDITS') {
      return new Response(JSON.stringify(outOfCreditsResponseBody()), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (isAIError(err) && err.kind === 'AUTH') {
      return new Response(
        JSON.stringify({
          error: 'ANTHROPIC_AUTH_FAILED',
          message: "Cle API Anthropic invalide. Verifie ANTHROPIC_API_KEY dans Coolify.",
          action: 'check_api_key',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }
    // Transient (RATE_LIMIT / OVERLOADED) or unknown — don't block the launch.
    // The pipeline's own retry/error handling will deal with it. We log so it's visible.
    const kind = isAIError(err) ? err.kind : 'UNKNOWN'
    console.warn(`[preflight] Anthropic check returned ${kind}, proceeding anyway: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

// Keep the AIError import non-tree-shaken in case downstream callers want the type.
export { AIError, isAIError }

// ============================================================
// AI Model Router
// Routes AI tasks to the appropriate provider/model based on
// task type, cost optimization, and capability requirements.
// Includes automatic retry + cross-provider fallback on
// transient errors (429, 503, 529).
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks'

import type { AITask, AIMessage, AIResponse, AIProvider, ModelConfig } from './types'
import { callClaude, streamClaude } from './claude'
import { callGemini } from './gemini'
import { callOpenAI } from './openai'

// ---- Task routing configuration ----

/**
 * Default model routing for each AI task.
 *
 * Routing strategy:
 * - Claude Sonnet: complex creative/analytical tasks (planning, writing, critique)
 * - Gemini Flash: fast, cheap tasks (title gen, meta, keyword extraction, summarization)
 */
const TASK_ROUTING: Record<AITask, ModelConfig> = {
  // --- Gemini 3.1 Pro: structured JSON analysis ---
  plan_article: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    maxTokens: 16384,
    temperature: 0.7,
    jsonMode: true,
  },
  analyze_serp: {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    maxTokens: 8192,
    temperature: 0.3,
    jsonMode: true,
  },
  // --- Claude Sonnet 4.6: quality writing & creative tasks ---
  write_block: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 0.8,
  },
  critique: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    temperature: 0.3,
  },
  generate_title: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 512,
    temperature: 0.7,
  },
  generate_meta: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 512,
    temperature: 0.5,
  },
  optimize_blocks: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 16384,
    temperature: 0.5,
    topP: 0.85,
  },
  generate_netlinking_article: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    temperature: 0.7,
  },
  // --- Gemini Flash: lightweight tasks ---
  extract_keywords: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 1024,
    temperature: 0.2,
  },
  summarize: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 1024,
    temperature: 0.3,
  },
  check_persona_consistency: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.2,
    jsonMode: true,
  },
  // --- Gemini Flash: fast JSON/analysis tasks ---
  analyze_competitor_content: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.2,
    jsonMode: true,
  },
  evaluate_authority_links: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 1024,
    temperature: 0.3,
    jsonMode: true,
  },
  extract_nuggets: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 8192,
    temperature: 0.3,
    jsonMode: true,
  },
  generate_backlink_anchor: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.3,
    jsonMode: true,
    thinkingLevel: 'LOW',
  },
  generate_backlink_sentences: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.4,
    jsonMode: true,
    thinkingLevel: 'LOW',
  },
  generate_table: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.3,
  },
  analyze_link_gap: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 4096,
    temperature: 0.3,
    jsonMode: true,
  },
  generate_article_angle: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.7,
    jsonMode: true,
  },
  generate_writing_directives: {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.6,
    jsonMode: true,
  },
}

// ---- Cross-provider fallback map ----

const FALLBACK_MODEL: Record<string, { provider: AIProvider; model: string }> = {
  'claude-sonnet-4-6': { provider: 'google', model: 'gemini-3-flash-preview' },
  'claude-haiku-4-5-20251001': { provider: 'google', model: 'gemini-3-flash-preview' },
  'gpt-4o': { provider: 'google', model: 'gemini-3-flash-preview' },
  'gpt-4o-mini': { provider: 'google', model: 'gemini-3-flash-preview' },
  'gemini-3.1-pro-preview': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'gemini-3.1-flash-preview': { provider: 'google', model: 'gemini-3-flash-preview' },
  'gemini-3-flash-preview': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
}

// ---- Retry / fallback helpers ----

function isRetryableError(error: unknown): boolean {
  // SDK errors with a numeric status code (Anthropic APIError, OpenAI APIError, etc.)
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    if (status === 429 || status === 529 || status === 503) return true
  }
  // Fallback: match common transient-error strings
  const msg = error instanceof Error ? error.message : String(error)
  return /overloaded|rate.?limit|too many requests|503|529/i.test(msg)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Hard cap on cross-provider fallbacks to prevent runaway cost spikes when the
// primary provider has a sustained outage (e.g. Anthropic rate-limiting an entire batch).
// Why 10/min: 50/min allowed up to ~360M tokens/day in Flash fallback, which is what we observed
// during the 2026-05-09/10 spike. 10/min = ~14k fallbacks/day max, hard ceiling against runaway cost.
const FALLBACK_RATE_LIMIT = 10
const FALLBACK_WINDOW_MS = 60_000
const fallbackTimestamps: number[] = []

// Tasks that must NEVER cross-provider fallback. These are high-token writes where
// a Flash fallback can still burn 4-8k output tokens × thousands of calls during an
// Anthropic outage. Better to fail loudly than silently swap providers and rack up cost.
const NO_FALLBACK_TASKS = new Set<AITask>([
  'write_block',
  'plan_article',
  'analyze_serp',
  'optimize_blocks',
  'generate_netlinking_article',
])

function checkFallbackRateLimit(): void {
  const now = Date.now()
  const cutoff = now - FALLBACK_WINDOW_MS
  while (fallbackTimestamps.length > 0 && fallbackTimestamps[0] < cutoff) {
    fallbackTimestamps.shift()
  }
  if (fallbackTimestamps.length >= FALLBACK_RATE_LIMIT) {
    throw new Error(
      `[ai-router] Fallback rate limit exceeded: ${fallbackTimestamps.length} fallbacks in last 60s. ` +
        `Aborting to prevent cost spike — primary provider likely down.`,
    )
  }
  fallbackTimestamps.push(now)
}

/**
 * Call a provider with the given config and messages.
 * Centralised dispatch to avoid duplicating the switch logic.
 */
function callProvider(
  config: ModelConfig,
  messages: AIMessage[],
  system?: string,
): Promise<AIResponse> {
  const opts = {
    model: config.model,
    messages,
    system,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  }
  if (config.provider === 'anthropic') return callClaude(opts)
  if (config.provider === 'openai') return callOpenAI(opts)
  return callGemini({ ...opts, jsonMode: config.jsonMode, topP: config.topP, thinkingLevel: config.thinkingLevel })
}

/**
 * Attempt an AI call with exponential backoff retries then cross-provider fallback:
 *  1. Initial try
 *  2. If retryable error → wait 2 s → retry
 *  3. If still failing → wait 5 s → retry
 *  4. If still failing → call fallback model (different provider)
 *  5. If fallback also fails → throw original error
 */
async function callWithRetryAndFallback(
  config: ModelConfig,
  messages: AIMessage[],
  system?: string,
  task?: AITask,
): Promise<AIResponse> {
  let lastError: unknown
  const retryDelays = [5000, 15000, 30000] // longer backoff — avoid premature fallback to expensive Gemini Pro during transient rate limits

  // --- Attempt 1: original model ---
  try {
    return await callProvider(config, messages, system)
  } catch (err) {
    lastError = err
    if (!isRetryableError(err)) throw err
    console.warn(
      `[ai-router] ${config.model} failed with retryable error, retrying in ${retryDelays[0] / 1000} s…`,
    )
  }

  // --- Attempts 2-3: retry same model with backoff ---
  for (let i = 0; i < retryDelays.length; i++) {
    await sleep(retryDelays[i])
    try {
      return await callProvider(config, messages, system)
    } catch (err) {
      lastError = err
      if (!isRetryableError(err)) throw err
      console.warn(
        `[ai-router] ${config.model} retry ${i + 2} failed${i < retryDelays.length - 1 ? `, retrying in ${retryDelays[i + 1] / 1000} s…` : ', falling back…'}`,
      )
    }
  }

  // --- Attempt 4: cross-provider fallback ---
  if (task && NO_FALLBACK_TASKS.has(task)) {
    console.warn(`[ai-router] Task "${task}" is no-fallback — failing instead of swapping provider`)
    throw lastError
  }
  const fb = FALLBACK_MODEL[config.model]
  if (!fb) throw lastError // no fallback configured

  checkFallbackRateLimit()

  const fallbackConfig: ModelConfig = {
    ...config,
    provider: fb.provider,
    model: fb.model,
  }
  console.warn(
    `[ai-router] Falling back to ${fb.model} (${fb.provider})`,
  )
  try {
    return await callProvider(fallbackConfig, messages, system)
  } catch {
    // Fallback also failed — throw the *original* error
    throw lastError
  }
}

// ---- Main routing functions ----

/**
 * Route an AI task to the appropriate provider and model.
 * All tasks use retry + cross-provider fallback:
 *   gemini-3.1-pro → gemini-3-flash
 *   gemini-3-flash → gemini-3.1-pro
 *
 * @param task     The task type (determines which model to use)
 * @param messages The conversation messages
 * @param system   Optional system prompt
 * @returns        AI response from the routed provider
 */
export async function routeAI(
  task: AITask,
  messages: AIMessage[],
  system?: string
): Promise<AIResponse> {
  const config = TASK_ROUTING[task]
  const response = await callWithRetryAndFallback(config, messages, system, task)
  costStorage.getStore()?.add(response, task)
  return response
}

/**
 * Stream an AI task response. Currently only supported for Anthropic provider.
 *
 * @param task     The task type
 * @param messages The conversation messages
 * @param system   Optional system prompt
 * @returns        ReadableStream<Uint8Array> with SSE events
 * @throws         Error if the task is routed to a non-streaming provider
 */
export function streamAI(
  task: AITask,
  messages: AIMessage[],
  system?: string
): ReadableStream<Uint8Array> {
  const config = TASK_ROUTING[task]

  if (config.provider !== 'anthropic') {
    throw new Error(
      `Le streaming n'est pas supporte pour la tache "${task}" ` +
      `(utilise le provider ${config.provider}). ` +
      'Seul Anthropic Claude supporte le streaming actuellement.'
    )
  }

  return streamClaude({
    model: config.model,
    messages,
    system,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  })
}

/**
 * Route an AI task with custom model config overrides.
 * Useful when the user wants to override the default model for a task.
 * Automatically retries once then falls back on transient errors.
 *
 * @param task      The task type (for default config fallback)
 * @param messages  The conversation messages
 * @param system    Optional system prompt
 * @param overrides Partial model config overrides
 * @returns         AI response from the routed provider
 */
export async function routeAIWithOverrides(
  task: AITask,
  messages: AIMessage[],
  system?: string,
  overrides?: Partial<ModelConfig>
): Promise<AIResponse> {
  const config = { ...TASK_ROUTING[task], ...overrides }
  const response = await callWithRetryAndFallback(config, messages, system, task)
  costStorage.getStore()?.add(response, task)
  return response
}

/**
 * Get the model configuration for a task.
 *
 * @param task The task type
 * @returns    The model configuration for this task
 */
export function getModelConfig(task: AITask): ModelConfig {
  return { ...TASK_ROUTING[task] }
}

/**
 * Get all task routing configurations.
 * Useful for displaying in the settings UI.
 */
export function getAllRoutingConfigs(): Record<AITask, ModelConfig> {
  // Return a deep copy to prevent mutation
  const configs: Record<string, ModelConfig> = {}
  for (const [task, config] of Object.entries(TASK_ROUTING)) {
    configs[task] = { ...config }
  }
  return configs as Record<AITask, ModelConfig>
}

// ---- Cost estimation ----

/**
 * Estimated cost per 1K tokens for each model.
 * Updated March 2026 — includes thinking token pricing for Gemini 3.x.
 * Gemini thinking tokens are billed separately and often dominate total cost.
 */
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number; thinking?: number }> = {
  // Claude — current Anthropic SDK returns ids with date suffix; we keep both forms
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5': { input: 0.001, output: 0.005 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'claude-opus-4-7': { input: 0.015, output: 0.075 },
  // Gemini
  'gemini-3.1-pro-preview': { input: 0.00125, output: 0.01, thinking: 0.0035 },
  'gemini-3.1-flash-preview': { input: 0.0001, output: 0.0004, thinking: 0.00035 },
  'gemini-3-flash-preview': { input: 0.0001, output: 0.0004, thinking: 0.00035 },
  'gemini-2.5-flash': { input: 0.00015, output: 0.0006, thinking: 0.00125 },
  // OpenAI
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
}

/**
 * Look up pricing for a model id. Anthropic returns full ids like
 * `claude-sonnet-4-6-20250929`, so we fall back to stripping the date suffix.
 * Logs a warning for unknown models so missing pricing surfaces in dev.
 */
function lookupPricing(model: string): { input: number; output: number; thinking?: number } | null {
  const exact = COST_PER_1K_TOKENS[model]
  if (exact) return exact
  // Strip trailing "-YYYYMMDD" date suffix
  const stripped = model.replace(/-\d{8}$/, '')
  if (stripped !== model) {
    const match = COST_PER_1K_TOKENS[stripped]
    if (match) return match
  }
  console.warn(`[ai-router] No pricing found for model "${model}" — cost tracked as $0`)
  return null
}

/**
 * Available models for user selection in the pipeline UI.
 */
export const AVAILABLE_MODELS = [
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    provider: 'anthropic' as const,
    costInput: 3,
    costOutput: 15,
    tag: 'Recommande',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic' as const,
    costInput: 1,
    costOutput: 5,
    tag: 'Equilibre',
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    provider: 'google' as const,
    costInput: 1.25,
    costOutput: 10.00,
    tag: 'Puissant',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    provider: 'google' as const,
    costInput: 0.10,
    costOutput: 0.40,
    tag: 'Rapide',
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai' as const,
    costInput: 0.15,
    costOutput: 0.60,
    tag: 'Economique+',
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    provider: 'openai' as const,
    costInput: 2.50,
    costOutput: 10,
    tag: 'Premium',
  },
] as const

export type AvailableModelId = (typeof AVAILABLE_MODELS)[number]['id']

/**
 * Convert a model ID to a ModelConfig override for routeAIWithOverrides.
 * Returns undefined if the model ID is not recognized.
 */
export function modelIdToOverride(modelId: string): Partial<ModelConfig> | undefined {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId)
  if (!model) return undefined
  return { provider: model.provider, model: model.id }
}

/**
 * Estimate the cost of an AI response based on token usage.
 *
 * @param response The AI response with token counts
 * @returns        Estimated cost in USD
 */
export function estimateCost(response: AIResponse): number {
  const pricing = lookupPricing(response.model)
  if (!pricing) return 0

  const inputCost = (response.tokensIn / 1000) * pricing.input

  // For Gemini: tokensOut includes thinking tokens (added in gemini.ts).
  // Separate them out so we can apply the correct per-token rate.
  const thinkingTokens = response.thinkingTokens || 0
  const pureOutputTokens = response.tokensOut - thinkingTokens
  const outputCost = (pureOutputTokens / 1000) * pricing.output

  // Gemini thinking tokens have their own pricing tier
  const thinkingCost = pricing.thinking
    ? (thinkingTokens / 1000) * pricing.thinking
    : 0

  // Anthropic prompt caching: cache writes cost 1.25x, cache reads cost 0.1x
  let cacheCost = 0
  if (response.cacheCreationTokens) {
    cacheCost += (response.cacheCreationTokens / 1000) * pricing.input * 1.25
  }
  if (response.cacheReadTokens) {
    cacheCost += (response.cacheReadTokens / 1000) * pricing.input * 0.1
  }

  return Math.round((inputCost + outputCost + thinkingCost + cacheCost) * 1000000) / 1000000 // 6 decimal places
}

/**
 * Estimate the cost of a task before running it.
 *
 * @param task             The task type
 * @param estimatedTokens  Estimated input token count
 * @returns                Estimated cost range in USD { min, max }
 */
export function estimateTaskCost(
  task: AITask,
  estimatedTokens: number
): { min: number; max: number; model: string } {
  const config = TASK_ROUTING[task]
  const pricing = lookupPricing(config.model)
  if (!pricing) return { min: 0, max: 0, model: config.model }

  const inputCost = (estimatedTokens / 1000) * pricing.input
  // Estimate output as 50-100% of maxTokens
  const minOutputCost = (config.maxTokens * 0.5 / 1000) * pricing.output
  const maxOutputCost = (config.maxTokens / 1000) * pricing.output

  return {
    min: Math.round((inputCost + minOutputCost) * 1000000) / 1000000,
    max: Math.round((inputCost + maxOutputCost) * 1000000) / 1000000,
    model: config.model,
  }
}

// ---- Automatic cost tracking via AsyncLocalStorage ----

/**
 * Per-call breakdown captured by the accumulator. Useful for debugging
 * runaway steps and feeding the analytics dashboard with granular data.
 */
export interface AICallRecord {
  task: AITask
  model: string
  provider: AIProvider
  tokensIn: number
  tokensOut: number
  thinkingTokens: number
  costUsd: number
  durationMs: number
  timestamp: number
}

export interface AggregatedCost {
  costUsd: number
  tokensIn: number
  tokensOut: number
  thinkingTokens: number
  callCount: number
  primaryModel: string | null
  calls: AICallRecord[]
}

/**
 * Accumulates AI call costs within an async context. Created by
 * `withCostTracking` and pushed to via the `routeAI` wrapper.
 */
export class CostAccumulator {
  private state: AggregatedCost = {
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    thinkingTokens: 0,
    callCount: 0,
    primaryModel: null,
    calls: [],
  }

  add(response: AIResponse, task: AITask): void {
    const cost = estimateCost(response)
    const thinking = response.thinkingTokens || 0
    this.state.costUsd += cost
    this.state.tokensIn += response.tokensIn
    this.state.tokensOut += response.tokensOut
    this.state.thinkingTokens += thinking
    this.state.callCount += 1
    if (!this.state.primaryModel) {
      this.state.primaryModel = response.model
    }
    this.state.calls.push({
      task,
      model: response.model,
      provider: response.provider,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      thinkingTokens: thinking,
      costUsd: cost,
      durationMs: response.durationMs,
      timestamp: Date.now(),
    })
  }

  get total(): AggregatedCost {
    return { ...this.state, calls: [...this.state.calls] }
  }
}

const costStorage = new AsyncLocalStorage<CostAccumulator>()

/**
 * Run `fn` with an active cost-tracking context. Every routeAI call
 * inside (including nested awaits) accumulates into the same accumulator.
 * The accumulator is also passed as the function argument for convenience.
 */
export async function withCostTracking<T>(
  fn: (costs: CostAccumulator) => Promise<T>,
): Promise<T> {
  const acc = new CostAccumulator()
  return costStorage.run(acc, () => fn(acc))
}

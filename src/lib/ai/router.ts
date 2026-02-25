// ============================================================
// AI Model Router
// Routes AI tasks to the appropriate provider/model based on
// task type, cost optimization, and capability requirements.
// Includes automatic retry + cross-provider fallback on
// transient errors (429, 503, 529).
// ============================================================

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
  plan_article: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
  },
  write_block: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2048,
    temperature: 0.8,
  },
  critique: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2048,
    temperature: 0.3,
  },
  generate_title: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 256,
    temperature: 0.7,
  },
  generate_meta: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 512,
    temperature: 0.5,
  },
  extract_keywords: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 1024,
    temperature: 0.2,
  },
  summarize: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 1024,
    temperature: 0.3,
  },
  analyze_serp: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 2048,
    temperature: 0.3,
  },
  analyze_competitor_content: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 2048,
    temperature: 0.2,
  },
}

// ---- Cross-provider fallback map ----

const FALLBACK_MODEL: Record<string, { provider: AIProvider; model: string }> = {
  'claude-sonnet-4-20250514': { provider: 'google', model: 'gemini-2.0-flash' },
  'claude-haiku-4-5-20251001': { provider: 'google', model: 'gemini-2.0-flash' },
  'gpt-4o': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'gpt-4o-mini': { provider: 'google', model: 'gemini-2.0-flash' },
  'gemini-3.1-pro-preview': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'gemini-3-flash-preview': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'gemini-2.0-flash': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
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
  return callGemini(opts)
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
): Promise<AIResponse> {
  let lastError: unknown
  const retryDelays = [2000, 5000] // exponential-ish backoff

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
  const fb = FALLBACK_MODEL[config.model]
  if (!fb) throw lastError // no fallback configured

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
 * Automatically retries once then falls back to an alternate provider
 * on transient errors (429, 503, 529).
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
  return callWithRetryAndFallback(config, messages, system)
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
  return callWithRetryAndFallback(config, messages, system)
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
 * These are approximate and should be updated when pricing changes.
 */
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  'gemini-3.1-pro-preview': { input: 0.002, output: 0.012 },
  'gemini-3-flash-preview': { input: 0.0005, output: 0.003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
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
    costInput: 2.00,
    costOutput: 12.00,
    tag: 'Puissant',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    provider: 'google' as const,
    costInput: 0.50,
    costOutput: 3.00,
    tag: 'Rapide',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    provider: 'google' as const,
    costInput: 0.10,
    costOutput: 0.40,
    tag: 'Economique',
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
  const pricing = COST_PER_1K_TOKENS[response.model]
  if (!pricing) return 0

  const inputCost = (response.tokensIn / 1000) * pricing.input
  const outputCost = (response.tokensOut / 1000) * pricing.output

  // Anthropic prompt caching: cache writes cost 1.25x, cache reads cost 0.1x
  let cacheCost = 0
  if (response.cacheCreationTokens) {
    cacheCost += (response.cacheCreationTokens / 1000) * pricing.input * 1.25
  }
  if (response.cacheReadTokens) {
    cacheCost += (response.cacheReadTokens / 1000) * pricing.input * 0.1
  }

  return Math.round((inputCost + outputCost + cacheCost) * 1000000) / 1000000 // 6 decimal places
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
  const pricing = COST_PER_1K_TOKENS[config.model]
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

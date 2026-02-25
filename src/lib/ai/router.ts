// ============================================================
// AI Model Router
// Routes AI tasks to the appropriate provider/model based on
// task type, cost optimization, and capability requirements
// ============================================================

import type { AITask, AIMessage, AIResponse, ModelConfig } from './types'
import { callClaude, streamClaude } from './claude'
import { callGemini } from './gemini'

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
}

// ---- Main routing functions ----

/**
 * Route an AI task to the appropriate provider and model.
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

  if (config.provider === 'anthropic') {
    return callClaude({
      model: config.model,
      messages,
      system,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    })
  }

  return callGemini({
    model: config.model,
    messages,
    system,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  })
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

  if (config.provider === 'anthropic') {
    return callClaude({
      model: config.model,
      messages,
      system,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    })
  }

  return callGemini({
    model: config.model,
    messages,
    system,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  })
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
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
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
  return Math.round((inputCost + outputCost) * 1000000) / 1000000 // 6 decimal places
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

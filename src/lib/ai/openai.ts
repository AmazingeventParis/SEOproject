// ============================================================
// OpenAI SDK wrapper
// Uses openai package for chat completions
// ============================================================

import OpenAI from 'openai'
import type { AIMessage, AIResponse } from './types'
import { getServerClient } from '@/lib/supabase/client'

// ---- Client factory ----

let client: OpenAI | null = null
let cachedKey: string | null = null

async function resolveApiKey(): Promise<string> {
  // 1. Env var
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) return envKey

  // 2. seo_config table (saved by Settings page as "openai_api_key")
  try {
    const supabase = getServerClient()
    const { data, error } = await supabase
      .from('seo_config')
      .select('value')
      .eq('key', 'openai_api_key')
      .single()

    if (!error && data?.value) {
      const val = data.value as unknown
      if (typeof val === 'string' && val.length > 0) return val
    }
  } catch {
    // fall through
  }

  throw new Error(
    'Cle API OpenAI non configuree. ' +
    'Configurez-la dans Settings ou via la variable OPENAI_API_KEY.'
  )
}

async function getClient(): Promise<OpenAI> {
  const apiKey = await resolveApiKey()
  if (!client || cachedKey !== apiKey) {
    client = new OpenAI({ apiKey })
    cachedKey = apiKey
  }
  return client
}

// ---- Non-streaming call ----

/**
 * Call OpenAI for a single chat completion.
 *
 * @param options  Model, messages, system prompt, and generation params
 * @returns        AI response with content, token counts, and timing
 */
export async function callOpenAI(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): Promise<AIResponse> {
  const start = Date.now()
  const openai = await getClient()

  const modelName = options.model || 'gpt-4o-mini'

  // Build messages array with optional system prompt
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (options.system) {
    msgs.push({ role: 'system', content: options.system })
  }
  for (const m of options.messages) {
    msgs.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })
  }

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: msgs,
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature ?? 0.7,
  })

  const choice = response.choices[0]

  return {
    content: choice?.message?.content || '',
    model: response.model,
    provider: 'openai',
    tokensIn: response.usage?.prompt_tokens || 0,
    tokensOut: response.usage?.completion_tokens || 0,
    durationMs: Date.now() - start,
  }
}

// ---- JSON response helper ----

/**
 * Call OpenAI and parse the response as JSON.
 * Handles common cases where the model wraps JSON in markdown code blocks.
 *
 * @param options  Same as callOpenAI
 * @returns        Parsed JSON object
 */
export async function callOpenAIJSON<T = unknown>(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): Promise<{ data: T; response: AIResponse }> {
  const response = await callOpenAI(options)
  let content = response.content.trim()

  // Strip markdown code block wrapper if present
  if (content.startsWith('```json')) {
    content = content.slice(7)
  } else if (content.startsWith('```')) {
    content = content.slice(3)
  }
  if (content.endsWith('```')) {
    content = content.slice(0, -3)
  }
  content = content.trim()

  try {
    const data = JSON.parse(content) as T
    return { data, response }
  } catch (parseError) {
    throw new Error(
      `Failed to parse OpenAI JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
      `Raw content: ${response.content.slice(0, 500)}`
    )
  }
}

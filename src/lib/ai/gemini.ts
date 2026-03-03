// ============================================================
// Google Gemini SDK wrapper
// Uses @google/genai (new unified SDK) for text generation
// ============================================================

import { GoogleGenAI } from '@google/genai'
import type { AIMessage, AIResponse } from './types'
import { getServerClient } from '@/lib/supabase/client'

// ---- Client factory ----

let genai: GoogleGenAI | null = null
let cachedKey: string | null = null

async function resolveApiKey(): Promise<string> {
  const envKey = process.env.GEMINI_API_KEY
  if (envKey) return envKey

  try {
    const supabase = getServerClient()
    const { data, error } = await supabase
      .from('seo_config')
      .select('value')
      .eq('key', 'gemini_api_key')
      .single()

    if (!error && data?.value) {
      const val = data.value as unknown
      if (typeof val === 'string' && val.length > 0) return val
    }
  } catch {
    // fall through
  }

  throw new Error(
    'Cle API Gemini non configuree. ' +
    'Configurez-la dans Settings ou via la variable GEMINI_API_KEY.'
  )
}

async function getClient(): Promise<GoogleGenAI> {
  const apiKey = await resolveApiKey()
  if (!genai || cachedKey !== apiKey) {
    genai = new GoogleGenAI({ apiKey })
    cachedKey = apiKey
  }
  return genai
}

// ---- Non-streaming call ----

/**
 * Call Gemini for a single message completion.
 *
 * @param options  Model, messages, system prompt, and generation params
 * @returns        AI response with content, token counts, and timing
 */
export async function callGemini(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
}): Promise<AIResponse> {
  const start = Date.now()
  const client = await getClient()

  const modelName = options.model || 'gemini-2.5-flash'

  // Build config
  const config: Record<string, unknown> = {
    maxOutputTokens: options.maxTokens || 2048,
    temperature: options.temperature ?? 0.7,
  }
  if (options.system) {
    config.systemInstruction = options.system
  }
  if (options.jsonMode) {
    config.responseMimeType = 'application/json'
  }
  // Gemini 3.x: disable thinking to avoid cost/latency/signature issues
  if (modelName.startsWith('gemini-3')) {
    config.thinkingConfig = { thinkingLevel: 'none' }
  }

  // Convert messages to chat history format
  const allMessages = options.messages
  const history = allMessages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }))
  const lastMessage = allMessages[allMessages.length - 1]

  const chat = client.chats.create({
    model: modelName,
    history,
    config,
  })
  const result = await chat.sendMessage({ message: lastMessage.content })
  const text = result.text ?? ''
  const usage = result.usageMetadata

  return {
    content: text,
    model: modelName,
    provider: 'google',
    tokensIn: usage?.promptTokenCount || 0,
    tokensOut: usage?.candidatesTokenCount || 0,
    durationMs: Date.now() - start,
  }
}

// ---- JSON response helper ----

/**
 * Call Gemini and parse the response as JSON.
 * Handles common cases where the model wraps JSON in markdown code blocks.
 *
 * @param options  Same as callGemini
 * @returns        Parsed JSON object
 */
export async function callGeminiJSON<T = unknown>(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): Promise<{ data: T; response: AIResponse }> {
  const response = await callGemini(options)
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
      `Failed to parse Gemini JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
      `Raw content: ${response.content.slice(0, 500)}`
    )
  }
}

// ---- Single-turn generation (no chat history) ----

/**
 * Simple single-turn text generation with Gemini.
 * Useful for quick tasks that don't need conversation context.
 *
 * @param prompt   The user prompt
 * @param options  Optional model config overrides
 * @returns        AI response
 */
export async function generateWithGemini(
  prompt: string,
  options?: {
    model?: string
    system?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<AIResponse> {
  const start = Date.now()
  const client = await getClient()

  const modelName = options?.model || 'gemini-2.5-flash'

  const config: Record<string, unknown> = {
    maxOutputTokens: options?.maxTokens || 2048,
    temperature: options?.temperature ?? 0.7,
  }
  if (options?.system) {
    config.systemInstruction = options.system
  }
  if (modelName.startsWith('gemini-3')) {
    config.thinkingConfig = { thinkingLevel: 'none' }
  }

  const result = await client.models.generateContent({
    model: modelName,
    contents: prompt,
    config,
  })
  const text = result.text ?? ''
  const usage = result.usageMetadata

  return {
    content: text,
    model: modelName,
    provider: 'google',
    tokensIn: usage?.promptTokenCount || 0,
    tokensOut: usage?.candidatesTokenCount || 0,
    durationMs: Date.now() - start,
  }
}

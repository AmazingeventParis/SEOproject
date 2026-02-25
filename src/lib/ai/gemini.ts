// ============================================================
// Google Gemini SDK wrapper
// Uses @google/generative-ai for text generation
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIMessage, AIResponse } from './types'

// ---- Singleton client ----

let genai: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY non configure. ' +
      'Ajoutez-le dans les variables d\'environnement ou dans Settings > Cles API.'
    )
  }
  if (!genai) {
    genai = new GoogleGenerativeAI(apiKey)
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
}): Promise<AIResponse> {
  const start = Date.now()
  const client = getClient()

  const modelName = options.model || 'gemini-2.0-flash'
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options.system || undefined,
    generationConfig: {
      maxOutputTokens: options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
    },
  })

  // Convert messages to Gemini's chat format
  // Gemini expects role: 'user' | 'model' (not 'assistant')
  const allMessages = options.messages
  const history = allMessages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }))
  const lastMessage = allMessages[allMessages.length - 1]

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(lastMessage.content)
  const response = result.response
  const text = response.text()
  const usage = response.usageMetadata

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
  const client = getClient()

  const modelName = options?.model || 'gemini-2.0-flash'
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: options?.system || undefined,
    generationConfig: {
      maxOutputTokens: options?.maxTokens || 2048,
      temperature: options?.temperature ?? 0.7,
    },
  })

  const result = await model.generateContent(prompt)
  const response = result.response
  const text = response.text()
  const usage = response.usageMetadata

  return {
    content: text,
    model: modelName,
    provider: 'google',
    tokensIn: usage?.promptTokenCount || 0,
    tokensOut: usage?.candidatesTokenCount || 0,
    durationMs: Date.now() - start,
  }
}

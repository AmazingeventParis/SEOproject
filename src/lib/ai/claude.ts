// ============================================================
// Anthropic Claude SDK wrapper
// Uses @anthropic-ai/sdk for message creation and streaming
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import type { AIMessage, AIResponse } from './types'

// ---- Singleton client ----

let client: Anthropic | null = null

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY non configure. ' +
      'Ajoutez-le dans les variables d\'environnement ou dans Settings > Cles API.'
    )
  }
  if (!client) {
    client = new Anthropic({ apiKey })
  }
  return client
}

// ---- Non-streaming call ----

/**
 * Call Claude for a single message completion.
 *
 * @param options  Model, messages, system prompt, and generation params
 * @returns        AI response with content, token counts, and timing
 */
export async function callClaude(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): Promise<AIResponse> {
  const start = Date.now()
  const anthropic = getClient()

  const response = await anthropic.messages.create({
    model: options.model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature ?? 0.7,
    system: options.system || undefined,
    messages: options.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  })

  // Extract text from the response content blocks
  const textContent = response.content.find((c) => c.type === 'text')

  return {
    content: textContent?.text || '',
    model: response.model,
    provider: 'anthropic',
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    durationMs: Date.now() - start,
  }
}

// ---- Streaming call (returns SSE-formatted ReadableStream) ----

/**
 * Stream a Claude response as a ReadableStream of SSE events.
 * Each event is formatted as: `data: { type, text|model|tokensIn|tokensOut }\n\n`
 *
 * Event types:
 * - `text`: a chunk of generated text
 * - `done`: final event with model and token usage info
 * - `error`: an error occurred during streaming
 *
 * @param options  Model, messages, system prompt, and generation params
 * @returns        ReadableStream<Uint8Array> suitable for Response body
 */
export function streamClaude(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const anthropic = getClient()

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = anthropic.messages.stream({
          model: options.model || 'claude-sonnet-4-20250514',
          max_tokens: options.maxTokens || 4096,
          temperature: options.temperature ?? 0.7,
          system: options.system || undefined,
          messages: options.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        })

        // Emit text chunks as SSE events
        stream.on('text', (text) => {
          const event = JSON.stringify({ type: 'text', text })
          controller.enqueue(encoder.encode(`data: ${event}\n\n`))
        })

        // Wait for the final message to get usage data
        const finalMessage = await stream.finalMessage()

        // Emit completion event with metadata
        const doneEvent = JSON.stringify({
          type: 'done',
          model: finalMessage.model,
          tokensIn: finalMessage.usage.input_tokens,
          tokensOut: finalMessage.usage.output_tokens,
        })
        controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`))
        controller.close()
      } catch (error) {
        // Emit error event and close
        const errorEvent = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
        controller.close()
      }
    },
  })
}

// ---- Helper: extract JSON from Claude response ----

/**
 * Call Claude and parse the response as JSON.
 * Handles common cases where Claude wraps JSON in markdown code blocks.
 *
 * @param options  Same as callClaude
 * @returns        Parsed JSON object
 */
export async function callClaudeJSON<T = unknown>(options: {
  model?: string
  messages: AIMessage[]
  system?: string
  maxTokens?: number
  temperature?: number
}): Promise<{ data: T; response: AIResponse }> {
  const response = await callClaude(options)
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
      `Failed to parse Claude JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}\n` +
      `Raw content: ${response.content.slice(0, 500)}`
    )
  }
}

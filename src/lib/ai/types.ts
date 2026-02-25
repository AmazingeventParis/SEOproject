// ============================================================
// Common AI types for the SEO pipeline
// ============================================================

export type AIProvider = 'anthropic' | 'google'

export type AITask =
  | 'plan_article'       // Generate article outline -> Claude
  | 'write_block'        // Write a content block -> Claude
  | 'critique'           // Review and critique content -> Claude
  | 'generate_title'     // Generate SEO title -> Gemini Flash
  | 'generate_meta'      // Generate meta description -> Gemini Flash
  | 'extract_keywords'   // Extract keywords from text -> Gemini Flash
  | 'summarize'          // Summarize content -> Gemini Flash
  | 'analyze_serp'       // Analyze SERP competitors -> Gemini Flash

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  content: string
  model: string
  provider: AIProvider
  tokensIn: number
  tokensOut: number
  durationMs: number
}

export interface AIStreamCallbacks {
  onToken?: (token: string) => void
  onComplete?: (response: AIResponse) => void
  onError?: (error: Error) => void
}

export interface ModelConfig {
  provider: AIProvider
  model: string
  maxTokens: number
  temperature: number
}

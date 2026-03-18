// ============================================================
// Common AI types for the SEO pipeline
// ============================================================

export type AIProvider = 'anthropic' | 'google' | 'openai'

export type AITask =
  | 'plan_article'       // Generate article outline -> Claude
  | 'write_block'        // Write a content block -> Claude
  | 'critique'           // Review and critique content -> Claude
  | 'generate_title'     // Generate SEO title -> Gemini Flash
  | 'generate_meta'      // Generate meta description -> Gemini Flash
  | 'extract_keywords'   // Extract keywords from text -> Gemini Flash
  | 'summarize'          // Summarize content -> Gemini Flash
  | 'analyze_serp'       // Analyze SERP competitors -> Gemini Flash
  | 'analyze_competitor_content' // Deep competitor content analysis -> Gemini Flash
  | 'evaluate_authority_links'   // Evaluate authority link candidates -> Gemini Flash
  | 'extract_nuggets'            // Extract knowledge nuggets from transcript -> Gemini Flash
  | 'generate_backlink_sentences' // Generate transition sentences for reverse backlinks -> Gemini Flash
  | 'generate_table'              // Convert selected text into a responsive HTML table -> Gemini Flash
  | 'optimize_blocks'             // Auto-optimize content blocks based on critique issues -> Gemini Pro
  | 'check_persona_consistency'   // Check persona voice consistency across blocks -> Gemini Flash
  | 'analyze_link_gap'             // Netlinking gap analysis -> Gemini Flash
  | 'generate_netlinking_article'  // Generate netlinking article -> Gemini Pro

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
  cacheCreationTokens?: number
  cacheReadTokens?: number
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
  jsonMode?: boolean
  topP?: number
}

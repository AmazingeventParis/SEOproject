// Structured AI error classification.
// Lets routes/UI distinguish between "out of credits" (user must recharge) vs
// "transient overload" (we may retry) vs "auth broken" vs "other" — and surface
// the right HTTP status + actionable message instead of an opaque 500.

export type AIErrorKind =
  | 'OUT_OF_CREDITS'
  | 'RATE_LIMIT'
  | 'OVERLOADED'
  | 'AUTH'
  | 'OTHER'

export type AIProvider = 'anthropic' | 'google' | 'openai'

export class AIError extends Error {
  kind: AIErrorKind
  status?: number
  provider: AIProvider
  retryable: boolean

  constructor(opts: {
    kind: AIErrorKind
    message: string
    provider: AIProvider
    status?: number
    retryable?: boolean
  }) {
    super(opts.message)
    this.name = 'AIError'
    this.kind = opts.kind
    this.status = opts.status
    this.provider = opts.provider
    this.retryable = opts.retryable ?? (opts.kind === 'RATE_LIMIT' || opts.kind === 'OVERLOADED')
  }
}

export function isAIError(err: unknown): err is AIError {
  return err instanceof AIError
}

/**
 * Classify a raw error from the Anthropic SDK into an AIError.
 * Anthropic returns:
 *   - 400 + "credit balance is too low" → OUT_OF_CREDITS
 *   - 429 → RATE_LIMIT
 *   - 503 / 529 → OVERLOADED
 *   - 401 / 403 → AUTH
 */
export function classifyAnthropicError(err: unknown): AIError {
  const status = (err as { status?: number })?.status
  const rawMsg = err instanceof Error ? err.message : String(err)

  if (status === 400 && /credit balance is too low/i.test(rawMsg)) {
    return new AIError({
      kind: 'OUT_OF_CREDITS',
      message: 'Anthropic credits exhausted',
      provider: 'anthropic',
      status,
      retryable: false,
    })
  }
  if (status === 429) {
    return new AIError({
      kind: 'RATE_LIMIT',
      message: rawMsg,
      provider: 'anthropic',
      status,
      retryable: true,
    })
  }
  if (status === 503 || status === 529) {
    return new AIError({
      kind: 'OVERLOADED',
      message: rawMsg,
      provider: 'anthropic',
      status,
      retryable: true,
    })
  }
  if (status === 401 || status === 403) {
    return new AIError({
      kind: 'AUTH',
      message: rawMsg,
      provider: 'anthropic',
      status,
      retryable: false,
    })
  }
  return new AIError({
    kind: 'OTHER',
    message: rawMsg,
    provider: 'anthropic',
    status,
    retryable: false,
  })
}

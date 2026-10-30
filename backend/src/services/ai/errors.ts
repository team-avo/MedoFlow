/**
 * AI provider failures as safe codes (FR-11, FR-14).
 *
 * Provider error bodies can echo the prompt (a transcript — PHI) and carry
 * internal hostnames, so an AiError's message is always one of the fixed
 * texts below. It is what gets stored in AIScribeSession.errorMessage, shown
 * to the provider, logged, and kept as a BullMQ failure reason.
 */

export type AiErrorCode =
  | 'ai_not_configured'
  | 'ai_unavailable'
  | 'ai_timeout'
  | 'ai_auth'
  | 'ai_rate_limited'
  | 'ai_rejected'
  | 'ai_bad_output'

const MESSAGES: Record<AiErrorCode, string> = {
  ai_not_configured: 'The AI scribe is not configured on this server.',
  ai_unavailable: 'The AI service could not be reached. Try again in a moment.',
  ai_timeout: 'The AI service took too long to respond. Try again.',
  ai_auth: 'The AI service rejected our credentials. An administrator must check the AI settings.',
  ai_rate_limited: 'The AI service is busy (rate limited). Try again in a moment.',
  ai_rejected: 'The AI service could not process this recording or request.',
  ai_bad_output: 'The AI returned an unusable draft. Regenerate it, or write the note manually.',
}

/** Retrying later can succeed for these; the others need a person to act. */
const RETRYABLE = new Set<AiErrorCode>(['ai_unavailable', 'ai_timeout', 'ai_rate_limited'])

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  /** HTTP status from the provider, when there was one (diagnostics only). */
  readonly providerStatus?: number

  constructor(code: AiErrorCode, providerStatus?: number) {
    super(MESSAGES[code])
    this.name = 'AiError'
    this.code = code
    this.retryable = RETRYABLE.has(code)
    this.providerStatus = providerStatus
  }
}

export const isAiError = (e: unknown): e is AiError => e instanceof AiError

/** Maps a provider HTTP status to a safe code. */
export function aiErrorForStatus(status: number): AiError {
  if (status === 401 || status === 403) return new AiError('ai_auth', status)
  if (status === 408 || status === 504) return new AiError('ai_timeout', status)
  if (status === 429) return new AiError('ai_rate_limited', status)
  if (status >= 500) return new AiError('ai_unavailable', status)
  return new AiError('ai_rejected', status)
}

/** Maps a thrown fetch/abort error to a safe code. */
export function aiErrorForThrown(e: unknown): AiError {
  if (isAiError(e)) return e
  const name = (e as { name?: string } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return new AiError('ai_timeout')
  return new AiError('ai_unavailable')
}

/**
 * The text that may be stored or shown for any failure in the scribe
 * pipeline. Non-AI errors (database, storage) get a generic message: their
 * text is not vetted for PHI.
 */
export function safeFailureMessage(e: unknown): { code: string; message: string } {
  if (isAiError(e)) return { code: e.code, message: e.message }
  return {
    code: 'processing_failed',
    message: 'Processing failed. Try again, or write the note manually.',
  }
}

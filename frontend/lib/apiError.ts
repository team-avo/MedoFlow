/**
 * The API's error code and message from an axios error, for recoverable UI
 * states. The backend's messages are written for people (and, for the AI
 * scribe, are fixed PHI-free texts), so they are safe to show as-is.
 */
export function apiErrorOf(err: unknown): { status?: number; code?: string; message: string } {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response
  const body = res?.data ?? {}
  const nested = (body.error ?? {}) as Record<string, unknown>
  const code = (body.code ?? nested.code) as string | undefined
  const message = (body.message ?? nested.message) as string | undefined
  return {
    status: res?.status,
    code,
    message: message || 'Something went wrong. Please try again.',
  }
}

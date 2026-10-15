import { isAxiosError } from 'axios'

/**
 * Turn an API failure into something safe to show: the API's own `code` (for
 * branching) and a short user-facing message. Server messages are generic by
 * design (B0.3.5); unknown/5xx failures get a fixed sentence so nothing from
 * a stack trace or request ever reaches the screen (F0.3.2).
 */
export function extractApiError(
  err: unknown,
  fallback: string
): { status?: number; code?: string; message: string } {
  if (!isAxiosError(err)) return { message: fallback }
  const status = err.response?.status
  const data = err.response?.data as { code?: unknown; message?: unknown } | undefined
  const code = typeof data?.code === 'string' ? data.code : undefined
  if (status === 429) return { status, code, message: 'Too many attempts. Try again in a minute.' }
  if (!status) return { message: 'We couldn’t reach the server. Please try again.' }
  if (status >= 500) return { status, code, message: 'Something went wrong. Please try again.' }
  const message = typeof data?.message === 'string' && data.message ? data.message : fallback
  return { status, code, message }
}

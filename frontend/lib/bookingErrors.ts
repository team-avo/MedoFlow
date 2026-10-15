/**
 * Booking failures the patient can recover from by picking another time:
 * the slot was taken by someone else (409 `conflict` — the API's own check or
 * the database overlap constraint, B1.1/B1.2), the hold no longer matches the
 * slot (`invalid_slot`), or the hold expired (`expired_hold`). The UI turns
 * these into a "slot taken — pick another time" step, never a raw error.
 */

export const SLOT_TAKEN_MESSAGE =
  'That time was just taken. Please pick another — the times shown are still open.'

const RECOVERABLE_CODES = new Set(['conflict', 'invalid_slot', 'expired_hold'])

interface ApiErrorShape {
  response?: { status?: number; data?: { code?: unknown; message?: unknown } }
}

export function isSlotUnavailableError(err: unknown): boolean {
  const res = (err as ApiErrorShape | null)?.response
  if (!res) return false
  const code = typeof res.data?.code === 'string' ? res.data.code : undefined
  if (code && RECOVERABLE_CODES.has(code)) return true
  // A 409 from a booking endpoint is always a slot conflict.
  return res.status === 409
}

/** The server's message for a deliberate 4xx, or a fallback. Never echoes 5xx bodies. */
export function bookingErrorMessage(err: unknown, fallback: string): string {
  const res = (err as ApiErrorShape | null)?.response
  const message = res?.data?.message
  if (res?.status && res.status >= 400 && res.status < 500 && typeof message === 'string') {
    return message
  }
  return fallback
}

import type { ApiError } from '../types/errors'

/** Exclusion constraint added by migration 20261014000000_appointment_no_overlap (B1.1). */
export const APPOINTMENT_OVERLAP_CONSTRAINT = 'Appointment_provider_no_overlap'

/** Postgres SQLSTATE for exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01'

/**
 * True when a database error is the provider-overlap exclusion constraint
 * rejecting a write. Prisma reports it either as a known request error
 * (raw queries: P2010 with meta.code 23P01) or as an unknown request error
 * whose message names the constraint (model writes).
 */
export function isAppointmentOverlapError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { meta?: { code?: unknown; message?: unknown }; message?: unknown }
  const metaMatches =
    e.meta?.code === EXCLUSION_VIOLATION &&
    (typeof e.meta.message !== 'string' || e.meta.message.includes(APPOINTMENT_OVERLAP_CONSTRAINT))
  const messageMatches =
    typeof e.message === 'string' && e.message.includes(APPOINTMENT_OVERLAP_CONSTRAINT)
  return metaMatches || messageMatches
}

/**
 * The clean client-facing error for a slot that another booking took first.
 * Same status/code as the application-level double-booking check, so clients
 * handle both paths identically.
 */
export function slotTakenError(): ApiError {
  const err = new Error(
    'This time slot was just booked by someone else. Please choose another time.'
  ) as ApiError
  err.statusCode = 409
  err.code = 'conflict'
  return err
}

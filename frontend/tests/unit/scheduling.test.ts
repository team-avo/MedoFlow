/**
 * Component 1 — Scheduling helpers: the slot-taken classifier behind the
 * booking recovery step (F1.1) and the cancellation-policy wording shown
 * before cancel/reschedule (F1.3).
 */
import { describe, expect, it } from 'vitest'
import { bookingErrorMessage, isSlotUnavailableError } from '@/lib/bookingErrors'
import { cancellationTerms, describeCancellationPolicy } from '@/lib/cancellationPolicy'

const apiError = (status: number, data: Record<string, unknown> = {}) => ({
  response: { status, data },
})

describe('isSlotUnavailableError', () => {
  it('treats a 409 conflict, a mismatched hold and an expired hold as "slot taken"', () => {
    expect(isSlotUnavailableError(apiError(409, { code: 'conflict' }))).toBe(true)
    expect(isSlotUnavailableError(apiError(409))).toBe(true)
    expect(isSlotUnavailableError(apiError(400, { code: 'expired_hold' }))).toBe(true)
    expect(isSlotUnavailableError(apiError(400, { code: 'invalid_slot' }))).toBe(true)
  })

  it('does not hide other failures behind the recovery step', () => {
    expect(isSlotUnavailableError(apiError(400, { code: 'validation_error' }))).toBe(false)
    expect(isSlotUnavailableError(apiError(500))).toBe(false)
    expect(isSlotUnavailableError(new Error('Network Error'))).toBe(false)
    expect(isSlotUnavailableError(null)).toBe(false)
  })
})

describe('bookingErrorMessage', () => {
  it('uses the server message for a deliberate 4xx and the fallback otherwise', () => {
    expect(bookingErrorMessage(apiError(400, { message: 'Needs 2 hours notice.' }), 'x')).toBe(
      'Needs 2 hours notice.'
    )
    expect(bookingErrorMessage(apiError(500, { message: 'stack trace…' }), 'Try again')).toBe(
      'Try again'
    )
    expect(bookingErrorMessage(undefined, 'Try again')).toBe('Try again')
  })
})

describe('cancellation policy', () => {
  const start = '2026-11-10T15:00:00.000Z'
  const fmt = (d: Date) => d.toISOString()

  it('no window or no fee → free at any time', () => {
    expect(describeCancellationPolicy(cancellationTerms(null, { startTime: start }))).toBe(
      'Free cancellation at any time.'
    )
    const noFee = cancellationTerms(
      { cancellationWindowHours: 24, cancellationFeeType: 'NONE' },
      { startTime: start }
    )
    expect(noFee.free).toBe(true)
  })

  it('a fixed fee: free until the window opens, then the fee applies', () => {
    const policy = {
      cancellationWindowHours: 24,
      cancellationFeeType: 'FIXED',
      cancellationFeeValue: '25',
    }
    const early = cancellationTerms(policy, { startTime: start }, new Date('2026-11-08T12:00:00Z'))
    expect(early).toMatchObject({ free: false, lateNow: false, feeText: '$25.00' })
    expect(early.freeUntil?.toISOString()).toBe('2026-11-09T15:00:00.000Z')
    expect(describeCancellationPolicy(early, fmt)).toBe(
      'Free cancellation until 2026-11-09T15:00:00.000Z. After that, a $25.00 fee applies.'
    )

    const late = cancellationTerms(policy, { startTime: start }, new Date('2026-11-10T09:00:00Z'))
    expect(late.lateNow).toBe(true)
    expect(describeCancellationPolicy(late, fmt)).toContain('cancelling now incurs a $25.00 fee')
  })

  it('a percentage fee is computed from the booked price', () => {
    const terms = cancellationTerms(
      { cancellationWindowHours: 48, cancellationFeeType: 'PERCENTAGE', cancellationFeeValue: 50 },
      { startTime: start, priceAtBooking: '80.00' }
    )
    expect(terms.feeText).toBe('50% ($40.00)')
  })
})

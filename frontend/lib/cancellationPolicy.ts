/**
 * The clinic's cancellation policy for a service, as the UI states it before
 * a patient or staff member cancels or reschedules (F1.3). Mirrors the
 * backend rule in appointmentService.cancelAppointment: inside the window
 * (hours before start) a FIXED or PERCENTAGE fee applies; outside it, free.
 */

export interface CancellationPolicyFields {
  cancellationWindowHours?: number | null
  cancellationFeeType?: string | null
  cancellationFeeValue?: string | number | null
}

export interface CancellationTerms {
  /** No fee ever applies. */
  free: boolean
  /** When free cancellation ends (null when there is no window). */
  freeUntil: Date | null
  /** True when cancelling now falls inside the window. */
  lateNow: boolean
  /** The fee if cancelled late, as display text ("$25.00" / "50% ($40.00)"). */
  feeText: string | null
}

const money = (n: number) => `$${n.toFixed(2)}`

export function cancellationTerms(
  policy: CancellationPolicyFields | null | undefined,
  appointment: { startTime: string; priceAtBooking?: string | number | null },
  now: Date = new Date()
): CancellationTerms {
  const windowHours = Math.max(0, Number(policy?.cancellationWindowHours ?? 0))
  const feeType = policy?.cancellationFeeType ?? 'NONE'
  const feeValue = policy?.cancellationFeeValue == null ? null : Number(policy.cancellationFeeValue)
  const start = new Date(appointment.startTime)
  const freeUntil = windowHours > 0 ? new Date(start.getTime() - windowHours * 3_600_000) : null
  const lateNow = freeUntil !== null && now >= freeUntil

  let feeText: string | null = null
  if (feeValue != null && !Number.isNaN(feeValue) && feeValue > 0) {
    if (feeType === 'FIXED') feeText = money(feeValue)
    if (feeType === 'PERCENTAGE') {
      const price = Number(appointment.priceAtBooking ?? NaN)
      feeText = Number.isNaN(price)
        ? `${feeValue}% of the visit price`
        : `${feeValue}% (${money((price * feeValue) / 100)})`
    }
  }
  return { free: freeUntil === null || feeText === null, freeUntil, lateNow, feeText }
}

/** One sentence describing the policy, for review screens and cancel dialogs. */
export function describeCancellationPolicy(
  terms: CancellationTerms,
  formatDate: (d: Date) => string = (d) =>
    d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
): string {
  if (terms.free || !terms.freeUntil) return 'Free cancellation at any time.'
  if (terms.lateNow) {
    return `This visit is inside the cancellation window — cancelling now incurs a ${terms.feeText} fee.`
  }
  return `Free cancellation until ${formatDate(terms.freeUntil)}. After that, a ${terms.feeText} fee applies.`
}

/**
 * Go-live gate (clinic onboarding). A clinic that signs up starts in
 * PENDING_REVIEW: its owner can set everything up, but nothing patient-facing
 * is reachable until a platform admin approves the application — no public
 * website, no public clinic API, no slot holds or bookings, no enquiry forms.
 *
 * Public code paths look clinics up with `liveClinicWhere` instead of a bare
 * `isActive: true`, so an unapproved clinic simply doesn't exist to them.
 * Signed-in admin paths (site editor preview, dashboard) are not gated.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

/** `where` fragment for a clinic patients may see: active and approved. */
export const liveClinicWhere = {
  isActive: true,
  tenant: { verificationStatus: 'APPROVED' },
} as const satisfies Prisma.ClinicWhereInput

/** True when the clinic is active and its application is approved. */
export async function isClinicLive(clinicId: string): Promise<boolean> {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, ...liveClinicWhere },
    select: { id: true },
  })
  return Boolean(clinic)
}

/**
 * Throws 404 when the clinic isn't live. 404 (not 403) so a pending clinic
 * looks exactly like one that doesn't exist.
 */
export async function assertClinicLive(clinicId: string): Promise<void> {
  if (await isClinicLive(clinicId)) return
  const err = new Error('Clinic not found') as ApiError
  err.statusCode = 404
  throw err
}

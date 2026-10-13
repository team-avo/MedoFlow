/**
 * Break-glass / emergency access (B0.2.6).
 *
 * A staff member who needs access their role doesn't grant (e.g. front desk
 * opening a chart during an emergency) activates a grant with a written
 * justification. While the grant is live:
 *  - their effective permissions become full access WITHIN THEIR OWN CLINIC
 *    (clinic isolation is never relaxed — allowedClinicIds is unchanged);
 *  - role checks (`authorize`) pass for staff routes;
 *  - every request writes a `critical` BREAK_GLASS_ACCESS audit row.
 * Grants are capped at BREAK_GLASS_MAX_MINUTES (default 60) and auto-expire:
 * an expired grant is ignored by `protect` the moment it lapses, and the cron
 * sweep records BREAK_GLASS_EXPIRED for it.
 */
import type { Request } from 'express'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import { ApiError } from '../types/errors'
import { logAudit, requestMeta } from './auditService'
import { raiseAlert } from './securityMonitorService'

export const MIN_JUSTIFICATION_LENGTH = 20
export const DEFAULT_GRANT_MINUTES = 30

export const getMaxGrantMinutes = (): number => {
  const v = Number(process.env.BREAK_GLASS_MAX_MINUTES)
  return Number.isFinite(v) && v > 0 ? Math.min(v, 240) : 60
}

const badRequest = (message: string, status = 400): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = status
  return err
}

export const activateBreakGlass = async (
  req: Request,
  input: { reason: string; durationMinutes?: number; patientId?: string | null }
) => {
  const user = req.user
  if (!user) throw badRequest('Authentication required', 401)
  if (user.role === 'PATIENT' || user.role === 'PLATFORM_ADMIN' || !user.clinicId) {
    throw badRequest('Break-glass access is only available to clinic staff', 403)
  }
  const reason = (input.reason ?? '').trim()
  if (reason.length < MIN_JUSTIFICATION_LENGTH) {
    throw badRequest(
      `A justification of at least ${MIN_JUSTIFICATION_LENGTH} characters is required`
    )
  }
  const minutes = input.durationMinutes ?? DEFAULT_GRANT_MINUTES
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > getMaxGrantMinutes()) {
    throw badRequest(`durationMinutes must be between 1 and ${getMaxGrantMinutes()}`)
  }

  const now = new Date()
  // One live grant at a time: end any previous one first.
  await prisma.breakGlassGrant.updateMany({
    where: { userId: user.id, clinicId: user.clinicId, endedAt: null, expiresAt: { gt: now } },
    data: { endedAt: now, endedReason: 'superseded' },
  })
  const grant = await prisma.breakGlassGrant.create({
    data: {
      userId: user.id,
      clinicId: user.clinicId,
      reason,
      patientId: input.patientId ?? null,
      expiresAt: new Date(now.getTime() + minutes * 60_000),
    },
  })
  await logAudit({
    clinicId: user.clinicId,
    entityType: 'BreakGlassGrant',
    entityId: grant.id,
    action: 'BREAK_GLASS_ACTIVATED',
    newValue: { reason, expiresAt: grant.expiresAt.toISOString(), patientId: grant.patientId },
    performedById: user.id,
    severity: 'critical',
    ...requestMeta(req),
  })
  raiseAlert(
    'break_glass_activated',
    `emergency access activated for ${minutes} min`,
    { userId: user.id, clinicId: user.clinicId, grantId: grant.id, minutes },
    `break_glass:${grant.id}`
  )
  return grant
}

export const endBreakGlass = async (req: Request) => {
  const user = req.user
  if (!user?.clinicId) return null
  const now = new Date()
  const grant = await getActiveGrant(user.id, user.clinicId, now)
  if (!grant) return null
  await prisma.breakGlassGrant.update({
    where: { id: grant.id, clinicId: user.clinicId },
    data: { endedAt: now, endedReason: 'ended_by_user' },
  })
  await logAudit({
    clinicId: user.clinicId,
    entityType: 'BreakGlassGrant',
    entityId: grant.id,
    action: 'BREAK_GLASS_ENDED',
    performedById: user.id,
    severity: 'critical',
    ...requestMeta(req),
  })
  return grant
}

export const getActiveGrant = async (userId: string, clinicId: string, now = new Date()) =>
  prisma.breakGlassGrant.findFirst({
    where: { userId, clinicId, endedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  })

/** Audit row written for every request made under an active grant. */
export const logBreakGlassAccess = async (
  req: Request,
  grant: { id: string; clinicId: string; userId: string }
): Promise<void> => {
  await logAudit({
    clinicId: grant.clinicId,
    entityType: 'BreakGlassGrant',
    entityId: grant.id,
    action: 'BREAK_GLASS_ACCESS',
    // Method + route path only: no query string, no body (they can carry PHI).
    newValue: { method: req.method, path: req.baseUrl + req.path },
    performedById: grant.userId,
    severity: 'critical',
    ...requestMeta(req),
  })
}

/** Cron: close out grants that lapsed, so the audit trail shows the expiry. */
export const expireBreakGlassGrants = async (now = new Date()): Promise<number> =>
  withTenantBypass('cron:break_glass_expiry', async () => {
    const expired = await prisma.breakGlassGrant.findMany({
      where: { endedAt: null, expiresAt: { lte: now } },
      select: { id: true, clinicId: true, userId: true },
    })
    for (const g of expired) {
      await prisma.breakGlassGrant.update({
        where: { id: g.id },
        data: { endedAt: now, endedReason: 'expired' },
      })
      await logAudit({
        clinicId: g.clinicId,
        entityType: 'BreakGlassGrant',
        entityId: g.id,
        action: 'BREAK_GLASS_EXPIRED',
        performedById: g.userId,
        severity: 'critical',
      })
    }
    return expired.length
  })

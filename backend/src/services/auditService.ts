import crypto from 'crypto'
import type { Request } from 'express'
import { Prisma, PrismaClient } from '@prisma/client'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import { recordRecordAccess } from './securityMonitorService'

export type AuditSeverity = 'info' | 'warning' | 'critical'

export interface LogAuditParams {
  /** Null only for auth events of users with no clinic (or unknown users). */
  clinicId: string | null
  entityType: string
  entityId: string
  action: string
  fieldChanged?: string | null
  oldValue?: unknown
  newValue?: unknown
  /** Null only when the actor is unknown (failed login for an unknown email). */
  performedById: string | null
  severity?: AuditSeverity
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Appends one row to the append-only AuditLog (B0.3.2 / B0.3.3). Rows
 * without a clinic (auth events) are written in a named bypass because no
 * clinic RLS policy can match them.
 */
export const logAudit = async (params: LogAuditParams): Promise<void> => {
  const {
    clinicId,
    entityType,
    entityId,
    action,
    fieldChanged,
    oldValue,
    newValue,
    performedById,
    severity,
    ipAddress,
    userAgent,
  } = params

  const write = () =>
    prisma.auditLog.create({
      data: {
        clinicId,
        entityType,
        entityId,
        action,
        fieldChanged: fieldChanged ?? null,
        oldValue: oldValue != null ? (oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
        newValue: newValue != null ? (newValue as Prisma.InputJsonValue) : Prisma.JsonNull,
        performedById,
        severity: severity ?? 'info',
        ipAddress: ipAddress ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
    })

  if (clinicId) await write()
  else await withTenantBypass('audit.unscoped_auth_event', write)
}

/** Client IP + user agent for audit rows. */
export const requestMeta = (
  req: Request
): { ipAddress: string | null; userAgent: string | null } => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
})

/**
 * Records that `req.user` viewed a sensitive record (B0.3.1). Only call this
 * for PHI-heavy reads — SOAP notes / visit records, scribe transcripts,
 * patient files — so audit volume stays meaningful. Also feeds the
 * anomalous-access monitor (B0.6.5).
 */
export const logRead = async (
  req: Request,
  entity: { entityType: string; entityId: string; clinicId: string | null }
): Promise<void> => {
  if (!req.user) return
  await logAudit({
    clinicId: entity.clinicId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    action: 'READ',
    performedById: req.user.id,
    ...requestMeta(req),
  })
  recordRecordAccess({
    userId: req.user.id,
    clinicId: entity.clinicId,
    entityType: entity.entityType,
    entityId: entity.entityId,
  })
}

export type AuthEventAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'SESSION_IDLE_TIMEOUT'
  | 'REFRESH_TOKEN_REUSE'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_SET'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_CHALLENGE_SUCCESS'
  | 'MFA_CHALLENGE_FAILURE'
  | 'MFA_RECOVERY_CODE_USED'
  | 'BREAK_GLASS_ACTIVATED'
  | 'BREAK_GLASS_ACCESS'
  | 'BREAK_GLASS_ENDED'
  | 'BREAK_GLASS_EXPIRED'

/** sha256 of the normalised email: correlates failed logins without storing the address. */
export const hashEmail = (email: string): string =>
  crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

/** Authentication / session events (B0.3.4). Never throws: auth must not fail on audit. */
export const logAuthEvent = async (params: {
  action: AuthEventAction
  userId: string | null
  clinicId: string | null
  req?: Request
  severity?: AuditSeverity
  details?: Record<string, unknown>
}): Promise<void> => {
  try {
    await logAudit({
      clinicId: params.clinicId,
      entityType: 'User',
      entityId: params.userId ?? 'unknown',
      action: params.action,
      newValue: params.details ?? null,
      performedById: params.userId,
      severity: params.severity ?? (params.action === 'LOGIN_FAILURE' ? 'warning' : 'info'),
      ...(params.req ? requestMeta(params.req) : {}),
    })
  } catch (err) {
    console.error('[audit] failed to write auth event', params.action, (err as Error).message)
  }
}

export const listAuditLogs = async (clinicId: string, limit = 100, offset = 0) => {
  return prisma.auditLog.findMany({
    where: { clinicId },
    include: {
      performedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  })
}

export const countAuditLogs = async (clinicId: string) => {
  return prisma.auditLog.count({
    where: { clinicId },
  })
}

// ─── Retention (B0.3.6) ──────────────────────────────────────────────────────

export const MIN_AUDIT_RETENTION_YEARS = 6

export const getAuditRetentionYears = (): number => {
  const raw = process.env.AUDIT_RETENTION_YEARS
  const years = raw ? Number(raw) : MIN_AUDIT_RETENTION_YEARS
  return Number.isFinite(years) ? years : NaN
}

export const auditRetentionCutoff = (now = new Date(), years = getAuditRetentionYears()): Date => {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return cutoff
}

let purgeClient: PrismaClient | null = null

/**
 * Deletes audit rows older than the retention window. The app role has no
 * DELETE grant on AuditLog, so this runs over AUDIT_PURGE_DATABASE_URL (the
 * owner role). A trigger rejects deleting anything younger than 6 years no
 * matter who asks, so a misconfigured cutoff cannot destroy retained rows.
 * Returns the number of rows deleted, or null when not configured.
 */
export const purgeExpiredAuditLogs = async (
  now = new Date(),
  client?: PrismaClient
): Promise<number | null> => {
  const years = getAuditRetentionYears()
  if (!(years >= MIN_AUDIT_RETENTION_YEARS)) {
    throw new Error(`AUDIT_RETENTION_YEARS must be ≥ ${MIN_AUDIT_RETENTION_YEARS}`)
  }
  let db = client
  if (!db) {
    const url = process.env.AUDIT_PURGE_DATABASE_URL
    if (!url) return null
    purgeClient ??= new PrismaClient({ datasourceUrl: url })
    db = purgeClient
  }
  const cutoff = auditRetentionCutoff(now, years)
  return db.$executeRaw`DELETE FROM "AuditLog" WHERE "createdAt" < ${cutoff}`
}

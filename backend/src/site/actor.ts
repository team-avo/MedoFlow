import type { Request } from 'express'
import { logAudit, requestMeta } from '../services/auditService'
import { siteError } from './errors'

/** Who is changing a clinic site, carried into every audited write. */
export interface SiteActor {
  clinicId: string
  userId: string
  ipAddress: string | null
  userAgent: string | null
}

export function actorFrom(req: Request): SiteActor {
  const clinicId = req.user?.clinicId
  const userId = req.user?.id
  if (!clinicId || !userId) throw siteError(403, 'site_no_clinic', 'Clinic context required')
  return { clinicId, userId, ...requestMeta(req) }
}

/**
 * One audit row per site change. Rows carry ids, slugs and counts only —
 * never page copy, and never lead contents (PHI).
 */
export function auditSite(
  actor: SiteActor,
  entry: {
    entityType: string
    entityId: string
    action: string
    fieldChanged?: string | null
    oldValue?: unknown
    newValue?: unknown
    severity?: 'info' | 'warning' | 'critical'
  }
): Promise<void> {
  return logAudit({
    clinicId: actor.clinicId,
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    ...entry,
  })
}

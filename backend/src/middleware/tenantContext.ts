import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'

/**
 * Resolves the tenantId for every request by looking up the authenticated
 * user's clinic → tenant relationship.
 *
 * The tenantId MUST come from the database, never from a request header or
 * query param (those are forgeable). JWT gives us the userId; we use that to
 * look up clinicId, then tenantId.
 *
 * PLATFORM_ADMIN users have clinicId=null; they bypass per-tenant scope and
 * must explicitly annotate routes with requirePlatformAdmin().
 *
 * Sets:
 *   req.tenantId: the resolved tenantId (null for PLATFORM_ADMIN)
 *   req.tenantContext: full tenant object with status/plan
 */
export async function resolveTenantContext(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      next()
      return
    }

    // PLATFORM_ADMIN users have no clinic affiliation
    if (req.user.role === 'PLATFORM_ADMIN') {
      req.tenantId = null
      next()
      return
    }

    // All other roles must belong to a clinic which belongs to a tenant
    const clinicId = req.user.clinicId
    if (!clinicId) {
      next(new Error('User has no clinic affiliation'))
      return
    }

    // Cache on req so downstream middleware doesn't re-query
    if (req.clinicId === clinicId && req.tenantId) {
      next()
      return
    }

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { tenantId: true, tenant: { select: { status: true, plan: true } } },
    })

    if (!clinic) {
      next(new Error('Clinic not found for authenticated user'))
      return
    }

    req.tenantId = clinic.tenantId
    req.tenantContext = clinic.tenant

    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Sets the Postgres session variable app.current_tenant_id so that RLS
 * policies on the Clinic and Brand tables enforce tenant isolation at the
 * DB level. Must be called inside a $transaction so the SET LOCAL scoping works.
 *
 * Usage (within a service):
 *   await withTenantScope(tenantId, async (tx) => {
 *     return tx.appointment.findMany({ where: { clinicId } })
 *   })
 */
export async function withTenantScope<T>(
  tenantId: string,
  fn: (tx: typeof prisma) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`
    return fn(tx as unknown as typeof prisma)
  })
}

/**
 * Express middleware that gates a route to PLATFORM_ADMIN only.
 * Use this on any route that operates across tenants.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'PLATFORM_ADMIN') {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }
  next()
}

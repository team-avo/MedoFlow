import type { Request, Response, NextFunction } from 'express'
import { withTenantContext } from '../config/tenantContext'

/**
 * Wraps the rest of the request chain in an AsyncLocalStorage scope so
 * downstream Prisma calls can introspect the caller's clinic/tenant.
 *
 * MUST be mounted AFTER `protect` (or `optionalProtect`) so `req.user` and
 * `req.clinicId` are populated. Before that point, calls to the tenant
 * guard see no context and will fail closed under enforce mode.
 *
 * For unauthenticated routes (login, register, public webhooks) we still
 * enter a context: with `bypassReason` set to the route-appropriate
 * string: so that legitimate auth queries don't trip the guard. See
 * `controllers/authController.ts` for examples of `withTenantBypass` use.
 */
export function bindTenantContext(req: Request, _res: Response, next: NextFunction): void {
  withTenantContext(
    {
      clinicId: req.user?.clinicId ?? null,
      tenantId: req.tenantId ?? null,
      userId: req.user?.id ?? null,
      role: req.user?.role ?? null,
      bypassReason: null,
    },
    () => next()
  )
}

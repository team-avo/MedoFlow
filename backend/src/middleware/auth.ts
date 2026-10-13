import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../utils/tokenUtils'
import prisma from '../config/prisma'
import type { Role } from '@prisma/client'
import type { ApiError } from '../types/errors'
import { hasPermission } from '../config/permissions'
import { withTenantBypass, withTenantContext } from '../config/tenantContext'
import { assertSessionActive } from '../services/sessionService'
import { getActiveGrant, logBreakGlassAccess } from '../services/breakGlassService'
import { logAuthEvent } from '../services/auditService'

interface AuthenticatedCaller {
  allowedClinicIds: string[]
}

/**
 * Verifies the bearer token, its server-side session (revocation, idle
 * timeout, MFA) and the user, then populates req.user / req.clinicId /
 * req.tenantId / req.breakGlass. All look-ups run in a named bypass because
 * no tenant context exists yet; the caller's own context is entered after.
 */
async function authenticate(req: Request, token: string): Promise<AuthenticatedCaller> {
  const decoded = verifyAccessToken(token)

  return withTenantBypass('auth.protect', async () => {
    let session
    try {
      session = await assertSessionActive(decoded.sid, decoded.userId, { touch: true })
    } catch (err) {
      if ((err as ApiError).code === 'session_idle_timeout') {
        await logAuthEvent({
          action: 'SESSION_IDLE_TIMEOUT',
          userId: decoded.userId,
          clinicId: decoded.clinicId ?? null,
          req,
        })
      }
      throw err
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clinicId: true,
        isActive: true,
        customRoleId: true,
        hasSeenPatientTour: true,
        mfaEnabled: true,
        // Pull tenant info in the same round-trip — this is the canonical
        // source of req.tenantId. PLATFORM_ADMIN has clinicId=null so this
        // include just yields null.
        clinic: {
          select: {
            tenantId: true,
            tenant: { select: { status: true, plan: true } },
          },
        },
        customRole: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    })

    if (!user) {
      const err = new Error('User not found') as ApiError
      err.statusCode = 401
      throw err
    }

    if (!user.isActive) {
      const err = new Error('Account is deactivated') as ApiError
      err.statusCode = 403
      throw err
    }

    if (user.mfaEnabled && !session.mfaVerifiedAt) {
      const err = new Error('Multi-factor verification required') as ApiError
      err.statusCode = 401
      err.code = 'mfa_required'
      throw err
    }

    // Resolve effective permissions
    let effectivePermissions: string[] = []
    if (user.role === 'PLATFORM_ADMIN' || user.role === 'SUPER_ADMIN') {
      effectivePermissions = ['*'] // full access
    } else if (user.customRole?.permissions) {
      effectivePermissions = user.customRole.permissions as string[]
    }

    // Clinics this caller may touch: staff → their clinic; patients → home
    // clinic + every clinic they're a member of.
    const allowedClinicIds = user.clinicId ? [user.clinicId] : []
    if (user.role === 'PATIENT') {
      const memberships = await prisma.patientClinicMembership.findMany({
        where: { patientId: user.id },
        select: { clinicId: true },
      })
      for (const m of memberships) {
        if (!allowedClinicIds.includes(m.clinicId)) allowedClinicIds.push(m.clinicId)
      }
    }

    // Break-glass: elevated permissions within the caller's own clinic.
    if (user.clinicId && user.role !== 'PATIENT' && user.role !== 'PLATFORM_ADMIN') {
      const grant = await getActiveGrant(user.id, user.clinicId)
      if (grant) {
        effectivePermissions = ['*']
        req.breakGlass = { id: grant.id, expiresAt: grant.expiresAt }
        await logBreakGlassAccess(req, grant)
      }
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
      customRoleId: user.customRoleId,
      customRoleName: user.customRole?.name ?? null,
      permissions: effectivePermissions,
      hasSeenPatientTour: user.hasSeenPatientTour,
      sessionId: session.id,
    }
    req.clinicId = user.clinicId
    // Canonical tenantId from clinic.tenantId. Null for PLATFORM_ADMIN or
    // any legacy user without a clinic — downstream code MUST handle null
    // explicitly (or use requireClinicScope/requireTenantScope middleware).
    req.tenantId = user.clinic?.tenantId ?? null
    req.tenantContext = user.clinic?.tenant ?? null

    return { allowedClinicIds }
  })
}

/**
 * Runs the rest of the request chain inside an ALS scope so the Prisma
 * tenant guard (and Postgres RLS) can assert that every clinic-scoped query
 * carries one of this caller's clinics. PLATFORM_ADMIN gets a bypass (they
 * work across tenants by design).
 */
function continueInCallerScope(
  req: Request,
  caller: AuthenticatedCaller,
  next: NextFunction,
  label: string
) {
  const user = req.user!
  if (user.role === 'PLATFORM_ADMIN') {
    withTenantBypass(label, () => next())
    return
  }
  withTenantContext(
    {
      clinicId: user.clinicId,
      tenantId: req.tenantId ?? null,
      userId: user.id,
      role: user.role,
      allowedClinicIds: caller.allowedClinicIds,
      bypassReason: null,
    },
    () => next()
  )
}

function normalizeAuthError(err: unknown): unknown {
  const error = err as ApiError
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    error.statusCode = 401
    error.message =
      error.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token'
  }
  return error
}

export const protect = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const err = new Error('Access token required') as ApiError
      err.statusCode = 401
      throw err
    }

    const caller = await authenticate(req, authHeader.split(' ')[1]!)
    continueInCallerScope(req, caller, next, 'platform_admin')
  } catch (err) {
    next(normalizeAuthError(err))
  }
}

/** Staff (non-patient) callers holding an active break-glass grant. */
const hasBreakGlass = (req: Request): boolean =>
  Boolean(req.breakGlass) && req.user?.role !== 'PATIENT'

/**
 * System-level role check (enum-based).
 * SUPER_ADMIN always passes. Other roles must be in the allowlist, unless
 * a staff member is operating under an active break-glass grant.
 */
export const authorize = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      const err = new Error('Authentication required') as ApiError
      err.statusCode = 401
      next(err)
      return
    }

    // PLATFORM_ADMIN and SUPER_ADMIN always pass any role check
    if (req.user.role === 'PLATFORM_ADMIN' || req.user.role === 'SUPER_ADMIN') {
      next()
      return
    }

    if (!roles.includes(req.user.role) && !(hasBreakGlass(req) && !onlyPatientRoles(roles))) {
      const err = new Error('Insufficient permissions') as ApiError
      err.statusCode = 403
      next(err)
      return
    }

    next()
  }
}

/** Patient-only routes stay patient-only even under break-glass. */
const onlyPatientRoles = (roles: Role[]): boolean =>
  roles.length > 0 && roles.every((r) => r === 'PATIENT')

/**
 * Granular permission check — works with custom roles.
 * SUPER_ADMIN bypasses all checks.
 * Staff users are checked against their custom role permissions.
 */
export const requirePermission = (...requiredKeys: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      const err = new Error('Authentication required') as ApiError
      err.statusCode = 401
      next(err)
      return
    }

    // PLATFORM_ADMIN and SUPER_ADMIN always have full access
    if (req.user.role === 'PLATFORM_ADMIN' || req.user.role === 'SUPER_ADMIN') {
      next()
      return
    }

    const userPerms = req.user.permissions ?? []
    const hasAll = requiredKeys.every((key) => hasPermission(userPerms, key))

    if (!hasAll) {
      const err = new Error('You do not have permission to perform this action') as ApiError
      err.statusCode = 403
      next(err)
      return
    }

    next()
  }
}

/**
 * Hard guard for routes that operate on clinic-scoped data. Returns 400 if
 * the authenticated user has no clinicId — which happens for PLATFORM_ADMIN
 * and for SUPER_ADMIN whose clinic setup isn't finished. Use this on
 * controllers that index into `clinicId` without a defensive check.
 *
 * Chain after `protect`. Example:
 *   router.post('/items', protect, requireClinicScope, controller.addItem)
 */
export const requireClinicScope = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    const err = new Error('Authentication required') as ApiError
    err.statusCode = 401
    next(err)
    return
  }
  if (!req.user.clinicId) {
    const err = new Error(
      'This action requires a clinic-scoped account. Platform admins must act on behalf of a specific clinic.'
    ) as ApiError
    err.statusCode = 400
    err.code = 'clinic_scope_required'
    next(err)
    return
  }
  next()
}

/**
 * Like `protect`, but an absent or invalid token is not an error: the request
 * continues unauthenticated in a public bypass scope. Route handlers on these
 * paths must scope their queries explicitly (see docs/PUBLIC_ROUTE_SCOPING.md).
 */
export const optionalProtect = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    withTenantBypass('optional_protect:unauthenticated', () => next())
    return
  }
  let caller: AuthenticatedCaller
  try {
    caller = await authenticate(req, authHeader.split(' ')[1]!)
  } catch {
    req.user = undefined
    req.breakGlass = undefined
    withTenantBypass('optional_protect:invalid_token', () => next())
    return
  }
  continueInCallerScope(req, caller, next, 'platform_admin:optional')
}

/**
 * Mount on any router that intentionally operates outside clinic scope
 * (login, register, refresh, webhooks, public storefront). The reason
 * string is logged if the tenant guard ever sees this context, so pick
 * something grep-able.
 */
export const withPublicScope = (reason: string) => {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    withTenantBypass(`public:${reason}`, () => next())
  }
}

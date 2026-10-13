import type { Role, TenantStatus, TenantPlan } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        name: string
        email: string
        role: Role
        clinicId: string | null
        customRoleId: string | null
        customRoleName: string | null
        permissions: string[]
        hasSeenPatientTour?: boolean
        /** UserSession bound to the access token (B0.2.1) */
        sessionId?: string
      }
      clinicId?: string | null
      /** Resolved from clinic → tenant; null for PLATFORM_ADMIN */
      tenantId?: string | null
      /** Tenant status/plan; used for feature-gating */
      tenantContext?: {
        status: TenantStatus
        plan: TenantPlan
      } | null
      bypassClinicScope?: boolean
      /** Active break-glass grant for this request (B0.2.6) */
      breakGlass?: {
        id: string
        expiresAt: Date
      }
    }
  }
}

export {}

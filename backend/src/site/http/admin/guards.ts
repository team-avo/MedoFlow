import { Role } from '@prisma/client'
import { protect, authorize } from '../../../middleware/auth'
import { requireClinic } from '../../../middleware/requireClinic'

/** Website editing: clinic owners and marketing staff. */
export const SITE_EDITORS = [Role.SUPER_ADMIN, Role.MARKETING] as const

/** Domains and plan-affecting settings: clinic owners only. */
export const SITE_OWNERS = [Role.SUPER_ADMIN] as const

/** Contact-form enquiries are PHI: owners and front desk (minimum necessary). */
export const LEAD_READERS = [Role.SUPER_ADMIN, Role.FRONT_DESK] as const

export const editorGuard = [protect, requireClinic, authorize(...SITE_EDITORS)]
export const ownerGuard = [protect, requireClinic, authorize(...SITE_OWNERS)]
export const leadGuard = [protect, requireClinic, authorize(...LEAD_READERS)]

import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { protect } from '../middleware/auth'
import { requirePlatformAdmin } from '../middleware/tenantContext'
import { validateRequest } from '../middleware/validateRequest'
import { authRateLimit } from '../middleware/rateLimit'
import * as dataLifecycleService from '../services/dataLifecycleService'
import { logAudit } from '../services/auditService'

/**
 * Customer off-boarding (B0.6.7). Platform admins only. Mounted at
 * /api/v1/platform/lifecycle.
 */
const router = Router()

router.use(protect, requirePlatformAdmin)

// GET /platform/lifecycle/tenants/:tenantId/export — full JSON export (download)
router.get(
  '/tenants/:tenantId/export',
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params['tenantId'])
    const exported = await dataLifecycleService.exportTenantData(tenantId)
    for (const clinic of exported.clinics) {
      await logAudit({
        clinicId: clinic.id,
        entityType: 'Tenant',
        entityId: tenantId,
        action: 'TENANT_EXPORTED',
        performedById: req.user!.id,
        severity: 'warning',
      })
    }
    res.setHeader('Content-Disposition', `attachment; filename="medoflow-export-${tenantId}.json"`)
    res.setHeader('Cache-Control', 'no-store')
    res.json(exported)
  })
)

const offboardSchema = {
  body: z.object({
    // Typed confirmation: the tenant's current slug.
    confirmSlug: z.string().min(1),
  }),
}

// POST /platform/lifecycle/tenants/:tenantId/offboard — irreversible destruction
router.post(
  '/tenants/:tenantId/offboard',
  authRateLimit,
  validateRequest(offboardSchema),
  asyncHandler(async (req, res) => {
    const { confirmSlug } = req.body as z.infer<typeof offboardSchema.body>
    const result = await dataLifecycleService.offboardTenant(String(req.params['tenantId']), {
      confirmSlug,
      performedById: req.user!.id,
    })
    successResponse(res, 200, 'Tenant off-boarded: data destroyed, accounts anonymised', result)
  })
)

export default router

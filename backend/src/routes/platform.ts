import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { protect } from '../middleware/auth'
import { requirePlatformAdmin } from '../middleware/tenantContext'
import { validateRequest } from '../middleware/validateRequest'
import * as platformAdminService from '../services/platformAdminService'

const router = Router()

router.use(protect, requirePlatformAdmin)

const createClinicSchema = {
  body: z.object({
    clinicName: z.string().min(2).max(100),
    clinicEmail: z.string().email(),
    ownerName: z.string().min(2).max(100),
    ownerEmail: z.string().email(),
    subdomain: z.string().min(3).max(63),
    plan: z.enum(['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE']).optional(),
  }),
}

router.post(
  '/clinics',
  validateRequest(createClinicSchema),
  asyncHandler(async (req, res) => {
    const result = await platformAdminService.createClinicByPlatform(
      req.body as platformAdminService.CreateClinicByPlatformInput
    )
    successResponse(res, 201, 'Clinic created', {
      tenantId: result.tenant.id,
      clinicId: result.clinic.id,
      subdomain: result.subdomain,
      ownerEmail: result.user.email,
      setupLink: result.setupLink,
    })
  })
)

const listSchema = {
  query: z.object({
    q: z.string().optional(),
    status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED']).optional(),
    plan: z.enum(['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
}

router.get(
  '/clinics',
  validateRequest(listSchema),
  asyncHandler(async (req, res) => {
    const result = await platformAdminService.listClinics(
      req.query as platformAdminService.ListClinicsFilters
    )
    successResponse(res, 200, 'Clinics', result)
  })
)

router.get(
  '/clinics/:tenantId',
  asyncHandler(async (req, res) => {
    const tenant = await platformAdminService.getClinicDetail(String(req.params['tenantId']))
    successResponse(res, 200, 'Clinic detail', tenant)
  })
)

router.post(
  '/clinics/:tenantId/resend-invite',
  asyncHandler(async (req, res) => {
    const result = await platformAdminService.resendInvite(String(req.params['tenantId']))
    successResponse(res, 200, 'Invite resent', result)
  })
)

export default router

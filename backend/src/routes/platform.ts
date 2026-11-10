import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { protect } from '../middleware/auth'
import { requirePlatformAdmin } from '../middleware/tenantContext'
import { validateRequest } from '../middleware/validateRequest'
import * as platformAdminService from '../services/platformAdminService'
import * as clinicApplicationService from '../services/clinicApplicationService'
import { reviewDecisionSchema, type ReviewDecisionInput } from '../validation/onboardingSchemas'

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
    verification: z
      .enum(['PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'])
      .optional(),
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
    const tenantId = String(req.params['tenantId'])
    const tenant = await platformAdminService.getClinicDetail(tenantId)
    // The practice application (NPI, tax ID, DEA, practitioners, signed
    // agreement) for the reviewer. Reading it is audited.
    const application = await clinicApplicationService.getApplicationForReview(
      tenantId,
      req.user!.id
    )
    successResponse(res, 200, 'Clinic detail', { ...tenant, application })
  })
)

router.post(
  '/clinics/:tenantId/resend-invite',
  asyncHandler(async (req, res) => {
    const result = await platformAdminService.resendInvite(String(req.params['tenantId']))
    successResponse(res, 200, 'Invite resent', result)
  })
)

/** Approve, request changes on, or reject a clinic application. */
router.post(
  '/clinics/:tenantId/review',
  validateRequest(reviewDecisionSchema),
  asyncHandler(async (req, res) => {
    const result = await clinicApplicationService.reviewApplication(
      String(req.params['tenantId']),
      req.body as ReviewDecisionInput,
      {
        userId: req.user!.id,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      }
    )
    successResponse(res, 200, 'Review recorded', result)
  })
)

export default router

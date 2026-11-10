import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import type { NextFunction, Request, Response } from 'express'
import { protect } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import * as onboardingService from '../services/onboardingService'
import * as clinicApplicationService from '../services/clinicApplicationService'
import {
  agreementSchema,
  practiceDetailsSchema,
  practitionersSchema,
  type AgreementInput,
  type PracticeDetailsInput,
  type PractitionerInput,
} from '../validation/onboardingSchemas'
import type { ApiError } from '../types/errors'

const router = Router()

/**
 * Onboarding is the clinic owner's job: only a SUPER_ADMIN of the clinic may
 * change it. Stricter than `authorize()`, which also admits break-glass staff.
 */
function ownerOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'SUPER_ADMIN') return next()
  const err = new Error('Only the clinic owner can do this') as ApiError
  err.statusCode = 403
  next(err)
}

const stepSchema = {
  body: z.object({
    step: z.number().int().min(0).max(6),
  }),
}

const brandSchema = {
  body: z.object({
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    secondaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    // Accept any string — data URLs (data:image/png;base64,…) fail z.string().url(),
    // so we validate format loosely (client is trusted for self-served tenants in Phase 2).
    logoUrl: z.string().min(1).max(5_000_000).nullable().optional(),
  }),
}

function requireClinic(clinicId: string | null | undefined): string {
  if (!clinicId) {
    const err = new Error('User has no clinic assigned') as ApiError
    err.statusCode = 403
    throw err
  }
  return clinicId
}

router.get(
  '/status',
  protect,
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const status = await onboardingService.getStatus(clinicId)
    successResponse(res, 200, 'Onboarding status', status)
  })
)

router.patch(
  '/step',
  protect,
  ownerOnly,
  validateRequest(stepSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const { step } = req.body as z.infer<typeof stepSchema.body>
    await onboardingService.setStep(clinicId, step)
    successResponse(res, 200, 'Step saved', { step })
  })
)

router.patch(
  '/brand',
  protect,
  ownerOnly,
  validateRequest(brandSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    await onboardingService.updateBrand(clinicId, req.body as z.infer<typeof brandSchema.body>)
    const status = await onboardingService.getStatus(clinicId)
    successResponse(res, 200, 'Brand updated', status)
  })
)

router.post(
  '/complete',
  protect,
  ownerOnly,
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    await onboardingService.complete(clinicId)
    successResponse(res, 200, 'Onboarding complete', { completedAt: new Date() })
  })
)

const actorOf = (req: Request) => ({
  userId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
})

// ─── Practice application (clinic onboarding) ───────────────────────────────

router.get(
  '/application',
  protect,
  ownerOnly,
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const application = await clinicApplicationService.getApplication(clinicId)
    successResponse(res, 200, 'Application', application)
  })
)

router.put(
  '/application/practice',
  protect,
  ownerOnly,
  validateRequest(practiceDetailsSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const application = await clinicApplicationService.savePracticeDetails(
      clinicId,
      req.body as PracticeDetailsInput,
      actorOf(req)
    )
    successResponse(res, 200, 'Practice details saved', application)
  })
)

router.put(
  '/application/practitioners',
  protect,
  ownerOnly,
  validateRequest(practitionersSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const { practitioners } = req.body as { practitioners: PractitionerInput[] }
    const application = await clinicApplicationService.savePractitioners(
      clinicId,
      practitioners,
      actorOf(req)
    )
    successResponse(res, 200, 'Practitioners saved', application)
  })
)

/** Sign the service agreement and submit the application for review. */
router.post(
  '/agreement',
  protect,
  ownerOnly,
  validateRequest(agreementSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const result = await clinicApplicationService.signAgreement(
      clinicId,
      req.body as AgreementInput,
      actorOf(req)
    )
    successResponse(res, 200, 'Agreement accepted', result)
  })
)

router.post(
  '/application/resubmit',
  protect,
  ownerOnly,
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const result = await clinicApplicationService.resubmit(clinicId, actorOf(req))
    successResponse(res, 200, 'Application resubmitted', result)
  })
)

export default router

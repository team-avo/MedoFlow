import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { protect } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import * as onboardingService from '../services/onboardingService'
import type { ApiError } from '../types/errors'
import prisma from '../config/prisma'

const router = Router()

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
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    await onboardingService.complete(clinicId)
    successResponse(res, 200, 'Onboarding complete', { completedAt: new Date() })
  })
)

const agreementSchema = {
  body: z.object({
    legalName: z.string().min(2).max(200),
    taxId: z.string().min(2).max(50),
    primaryContactName: z.string().min(2).max(200),
    primaryContactEmail: z.string().email(),
    mailingAddress: z.string().min(5).max(500),
    estimatedSeats: z.number().int().min(1).max(1000),
    confirmClinicName: z.string().min(1).max(200),
    acknowledgements: z.object({
      baa: z.boolean(),
      hipaa: z.boolean(),
      dataResidency: z.boolean(),
      refundPolicy: z.boolean(),
      authorizedSignatory: z.boolean(),
    }),
  }),
}

router.post(
  '/agreement',
  protect,
  validateRequest(agreementSchema),
  asyncHandler(async (req, res) => {
    const clinicId = requireClinic(req.user?.clinicId)
    const userId = req.user!.id

    // Confirmation modal requires the user to retype the clinic name; verify it
    // matches the tenant on file before accepting.
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { tenant: { select: { name: true } } },
    })
    const expectedName = clinic?.tenant?.name?.trim().toLowerCase() ?? ''
    const body = req.body as z.infer<typeof agreementSchema.body>
    const provided = body.confirmClinicName.trim().toLowerCase()
    if (!expectedName || expectedName !== provided) {
      const err = new Error('Confirmation name does not match clinic on file') as ApiError
      err.statusCode = 400
      throw err
    }

    const { confirmClinicName: _confirm, ...input } = body
    const result = await onboardingService.acceptTerms(clinicId, userId, input)
    successResponse(res, 200, 'Agreement accepted', result)
  })
)

export default router

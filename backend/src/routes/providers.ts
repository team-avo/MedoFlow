import { Router } from 'express'
import { z } from 'zod'
import * as providerController from '../controllers/providerController'
import * as availabilityController from '../controllers/availabilityController'
import * as providerProfileService from '../services/providerProfileService'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { Role } from '@prisma/client'
import {
  providerCreateSchema,
  providerServiceCreateSchema,
  providerServiceUpdateSchema,
  providerUpdateSchema,
} from '../validation/module1Schemas'

const router = Router()

router.get('/:id/availability', availabilityController.getProviderAvailability)

router.use(protect)
router.use(requireClinic)

// Provider self-service profile (must come before /:id catchalls)
const profileUpdateSchema = {
  body: z.object({
    bio: z.string().max(2000).nullable().optional(),
    headshotUrl: z.string().max(5_000_000).nullable().optional(),
    signatureUrl: z.string().max(5_000_000).nullable().optional(),
    licenseNumber: z.string().max(100).nullable().optional(),
    languages: z.array(z.string().min(1).max(50)).max(20).optional(),
    phone: z.string().max(50).nullable().optional(),
    scribeTemplateId: z.string().nullable().optional(),
    scribeTone: z.enum(['CONCISE', 'DETAILED']).optional(),
    scribeIncludeCoding: z.boolean().optional(),
  }),
}

router.get(
  '/me/profile',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const profile = await providerProfileService.getMyProfile(req.user!.id)
    successResponse(res, 200, 'Profile', profile)
  })
)

router.put(
  '/me/profile',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN),
  validateRequest(profileUpdateSchema),
  asyncHandler(async (req, res) => {
    const profile = await providerProfileService.updateMyProfile(
      req.user!.id,
      req.body as providerProfileService.ProviderProfileUpdate
    )
    successResponse(res, 200, 'Profile updated', profile)
  })
)

router.get(
  '/me/scribe-templates',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const templates = await providerProfileService.listAvailableTemplates(req.user!.id)
    successResponse(res, 200, 'Templates', { items: templates })
  })
)

router.post(
  '/',
  authorize(Role.SUPER_ADMIN),
  validateRequest(providerCreateSchema),
  providerController.create
)
router.get(
  '/',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PROVIDER),
  providerController.list
)
router.get(
  '/:id/services',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PROVIDER),
  providerController.listServices
)
router.post(
  '/:id/services',
  authorize(Role.SUPER_ADMIN),
  validateRequest(providerServiceCreateSchema),
  providerController.addService
)
router.put(
  '/:id/services/:serviceId',
  authorize(Role.SUPER_ADMIN),
  validateRequest(providerServiceUpdateSchema),
  providerController.updateService
)
router.delete(
  '/:id/services/:serviceId',
  authorize(Role.SUPER_ADMIN),
  providerController.removeService
)
router.get(
  '/:id',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PROVIDER),
  providerController.getById
)
router.post(
  '/:id/availability/preview',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  availabilityController.previewAvailabilityUpdate
)
router.post(
  '/:id/availability',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  availabilityController.createAvailability
)
router.put(
  '/:id/availability/:availabilityId',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  availabilityController.updateAvailability
)
router.post(
  '/:id/unavailability',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  availabilityController.createUnavailability
)
router.put(
  '/:id',
  authorize(Role.SUPER_ADMIN),
  validateRequest(providerUpdateSchema),
  providerController.update
)
router.delete('/:id', authorize(Role.SUPER_ADMIN), providerController.remove)

export default router

import { Router } from 'express'
import * as locationController from '../controllers/locationController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { validateRequest } from '../middleware/validateRequest'
import { Role } from '@prisma/client'
import { locationPatchSchema, locationUpsertSchema } from '../validation/module1Schemas'

const router = Router()

router.use(protect)
router.use(requireClinic)

router.post(
  '/',
  authorize(Role.SUPER_ADMIN),
  validateRequest(locationUpsertSchema),
  locationController.create
)
router.get(
  '/',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PROVIDER),
  locationController.list
)

router.patch(
  '/:id',
  authorize(Role.SUPER_ADMIN),
  validateRequest(locationPatchSchema),
  locationController.update
)

export default router

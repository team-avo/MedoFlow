import { Router } from 'express'
import * as treatmentPlanController from '../controllers/treatmentPlanController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'
import { validateRequest } from '../middleware/validateRequest'
import {
  treatmentPlanCreateSchema,
  treatmentPlanUpdateSchema,
  idParamsSchema,
  patientIdParamsSchema,
} from '../validation/clinicalRecordsSchemas'

const router = Router()

router.use(protect)
router.use(requireClinic)

router.post(
  '/',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ body: treatmentPlanCreateSchema }),
  treatmentPlanController.create
)

router.get(
  '/',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  treatmentPlanController.getList
)

router.get(
  '/patient/:patientId',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ params: patientIdParamsSchema }),
  treatmentPlanController.getByPatient
)

router.get(
  '/:id',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ params: idParamsSchema }),
  treatmentPlanController.getById
)

router.put(
  '/:id',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ params: idParamsSchema, body: treatmentPlanUpdateSchema }),
  treatmentPlanController.update
)

router.put(
  '/:id/complete',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ params: idParamsSchema }),
  treatmentPlanController.complete
)

router.put(
  '/:id/discontinue',
  authorize(Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN),
  validateRequest({ params: idParamsSchema }),
  treatmentPlanController.discontinue
)

export default router

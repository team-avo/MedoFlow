import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as prescriptionController from '../controllers/prescriptionController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'
import { validateRequest } from '../middleware/validateRequest'
import {
  prescriptionCreateSchema,
  patientIdParamsSchema,
} from '../validation/clinicalRecordsSchemas'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

router.post(
  '/',
  authorize(Role.PROVIDER),
  requireClinic,
  validateRequest({ body: prescriptionCreateSchema }),
  prescriptionController.create
)
router.get('/my', authorize(Role.PATIENT), setClinicFromUser, prescriptionController.getMy)
router.get('/provider', authorize(Role.PROVIDER), requireClinic, prescriptionController.getProvider)
router.get(
  '/patient/:patientId',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  validateRequest({ params: patientIdParamsSchema }),
  prescriptionController.getByPatient
)
router.get(
  '/clinic',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  prescriptionController.listClinic
)

export default router

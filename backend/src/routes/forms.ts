import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as formController from '../controllers/formController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

router.post(
  '/templates',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  formController.createTemplate
)

router.get(
  '/templates',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  formController.listTemplates
)

router.put(
  '/templates/:id',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  formController.updateTemplate
)

router.delete(
  '/templates/:id',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  formController.disableTemplate
)

router.get(
  '/templates/for-appointment/:appointmentId',
  authorize(Role.PATIENT),
  formController.getTemplatesForAppointment
)

router.post('/respond', authorize(Role.PATIENT), formController.submitResponse)

router.get(
  '/patient/:patientId',
  authorize(Role.PROVIDER, Role.PATIENT, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  formController.getResponsesByPatient
)

export default router

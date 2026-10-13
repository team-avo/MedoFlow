import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as visitController from '../controllers/visitController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

router.post('/', authorize(Role.PROVIDER), requireClinic, visitController.create)

router.get(
  '/appointment/:appointmentId',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PATIENT),
  setClinicFromUser,
  visitController.getByAppointment
)
router.get(
  '/patient/:patientId',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  visitController.getByPatient
)
router.get(
  '/:id',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK, Role.PATIENT),
  setClinicFromUser,
  visitController.getById
)
router.put('/:id', authorize(Role.PROVIDER), requireClinic, visitController.update)
router.put('/:id/finalize', authorize(Role.PROVIDER), requireClinic, visitController.finalize)
router.get(
  '/clinic',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  visitController.listClinic
)

export default router

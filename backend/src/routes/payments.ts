import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as paymentController from '../controllers/paymentController'
import { protect, authorize } from '../middleware/auth'
import { Role } from '@prisma/client'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

router.post(
  '/:appointmentId/intent',
  authorize(Role.PATIENT, Role.FRONT_DESK),
  setClinicFromUser,
  paymentController.intent
)

router.post(
  '/:appointmentId/confirm',
  authorize(Role.PATIENT, Role.FRONT_DESK),
  setClinicFromUser,
  paymentController.confirm
)

router.post(
  '/:appointmentId/demo-confirm',
  authorize(Role.PATIENT, Role.FRONT_DESK),
  setClinicFromUser,
  paymentController.demoConfirm
)

router.post(
  '/:appointmentId/fail',
  authorize(Role.PATIENT, Role.FRONT_DESK),
  setClinicFromUser,
  paymentController.fail
)

router.post(
  '/:paymentId/refund',
  authorize(Role.FRONT_DESK, Role.SUPER_ADMIN),
  setClinicFromUser,
  paymentController.refund
)

export default router

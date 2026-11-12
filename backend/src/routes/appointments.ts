import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as appointmentController from '../controllers/appointmentController'
import * as publicController from '../controllers/publicController'
import { protect, authorize, authorizeRolesOrPermission } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { validateRequest } from '../middleware/validateRequest'
import { Role } from '@prisma/client'
import {
  appointmentCreateSchema,
  appointmentRecurringSchema,
  appointmentRescheduleSchema,
  appointmentSeriesCancelSchema,
} from '../validation/module2Schemas'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

// CTO-24: anyone with admin access books: the owner (often the doctor), the
// front desk, and custom roles holding `appointments.create`.
router.post(
  '/',
  authorizeRolesOrPermission([Role.PATIENT, Role.FRONT_DESK], 'appointments.create'),
  setClinicFromUser,
  validateRequest(appointmentCreateSchema),
  appointmentController.create
)

// CTO-24: open slots for staff booking from the dashboard (not behind the
// go-live gate, unlike /public/availability).
router.get(
  '/availability',
  authorizeRolesOrPermission([Role.FRONT_DESK], 'appointments.create'),
  setClinicFromUser,
  publicController.getStaffAvailability
)

router.post(
  '/recurring',
  authorize(Role.PATIENT, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  validateRequest(appointmentRecurringSchema),
  appointmentController.createRecurring
)

// F1.2: staff cancel every upcoming visit of a recurring series in one action.
router.post(
  '/recurring/:seriesId/cancel',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  validateRequest(appointmentSeriesCancelSchema),
  appointmentController.cancelSeries
)

router.get('/my', authorize(Role.PATIENT), setClinicFromUser, appointmentController.getMy)

router.get('/provider', authorize(Role.PROVIDER), requireClinic, appointmentController.getProvider)

router.get(
  '/patient/:patientId',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  appointmentController.getByPatient
)

router.get(
  '/clinic',
  authorize(Role.SUPER_ADMIN, Role.FRONT_DESK),
  requireClinic,
  appointmentController.getClinic
)

router.get(
  '/:id/timeline',
  authorize(Role.PATIENT, Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  appointmentController.getTimeline
)

router.get(
  '/:id',
  authorize(Role.PATIENT, Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  appointmentController.getById
)

router.put(
  '/:id/status',
  authorize(Role.PATIENT, Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  appointmentController.updateStatus
)

router.post(
  '/:id/cancel',
  authorize(Role.PATIENT, Role.PROVIDER, Role.FRONT_DESK),
  setClinicFromUser,
  appointmentController.cancel
)

router.post(
  '/:id/reschedule',
  authorize(Role.PATIENT, Role.PROVIDER, Role.FRONT_DESK),
  setClinicFromUser,
  validateRequest(appointmentRescheduleSchema),
  appointmentController.reschedule
)

export default router

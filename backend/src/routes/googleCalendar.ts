import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'
import * as googleCalendarController from '../controllers/googleCalendarController'

const router = Router()

router.use(protect)

const setClinicFromUser = (req: Request, _res: Response, next: NextFunction): void => {
  req.clinicId = req.user?.clinicId ?? null
  next()
}

router.get(
  '/auth-url',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.getAuthUrl
)

router.post(
  '/connect',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.connect
)

router.post(
  '/sync',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.syncEvents
)

router.get(
  '/status',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.status
)

router.delete(
  '/disconnect',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.disconnect
)

router.get(
  '/events',
  authorize(Role.PROVIDER, Role.SUPER_ADMIN, Role.FRONT_DESK),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.listEvents
)

router.get(
  '/events/:eventId/appointments-candidates',
  authorize(Role.PROVIDER),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.listEventAppointmentCandidates
)

router.post(
  '/events/:eventId/link-appointment',
  authorize(Role.PROVIDER),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.linkEventToAppointment
)

router.post(
  '/events/:eventId/start-scribe',
  authorize(Role.PROVIDER),
  setClinicFromUser,
  requireClinic,
  googleCalendarController.startScribeFromMeeting
)

export default router

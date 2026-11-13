/**
 * The signed-in user's own notifications (CTO-30): the bell and the Command
 * Center "starting soon" card. Users only ever see and mark their own.
 */
import { Router } from 'express'
import { protect } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import * as providerReminderService from '../services/providerReminderService'

const router = Router()
router.use(protect)
router.use(requireClinic)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await providerReminderService.listMyNotifications(req.user!.id, req.clinicId!)
    successResponse(res, 200, 'Notifications', data)
  })
)

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const updated = await providerReminderService.markRead(req.user!.id, req.clinicId!)
    successResponse(res, 200, 'Marked read', { updated })
  })
)

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const updated = await providerReminderService.markRead(
      req.user!.id,
      req.clinicId!,
      String(req.params['id'])
    )
    successResponse(res, 200, 'Marked read', { updated })
  })
)

export default router

import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import * as waitlistController from '../controllers/waitlistController'
import { protect, authorize } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { Role } from '@prisma/client'
import { waitlistCreateSchema } from '../validation/module2Schemas'

const router = Router()

router.use(protect)
router.use(authorize(Role.PATIENT))

router.post(
  '/',
  validateRequest(waitlistCreateSchema),
  (req: Request, _res: Response, next: NextFunction): void => {
    req.clinicId =
      req.user?.clinicId ?? (req.body as { clinicId?: string } | undefined)?.clinicId ?? null
    next()
  },
  waitlistController.add
)

router.get('/my', waitlistController.getMy)

router.post('/:id/claim', waitlistController.claim)

export default router

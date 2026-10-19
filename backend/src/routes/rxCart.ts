import { Router } from 'express'
import { Role } from '@prisma/client'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import * as rxCartController from '../controllers/rxCartController'
import {
  confirmProposalSchema,
  idParamSchema,
  sessionIdParamSchema,
  updateProposalLinesSchema,
} from '../validation/rxCartSchemas'

// Prescription → Cart, provider side (B5.1–B5.3). Patients never reach these.
const router = Router()

router.use(protect, requireClinicScope, authorize(Role.PROVIDER))

router.get('/catalog', rxCartController.getCatalog)
router.get(
  '/sessions/:sessionId/proposal',
  validateRequest({ params: sessionIdParamSchema }),
  rxCartController.getProposal
)
router.put(
  '/proposals/:id/lines',
  validateRequest({ params: idParamSchema, body: updateProposalLinesSchema }),
  rxCartController.updateLines
)
router.post(
  '/proposals/:id/confirm',
  validateRequest({ params: idParamSchema, body: confirmProposalSchema }),
  rxCartController.confirm
)

export default router

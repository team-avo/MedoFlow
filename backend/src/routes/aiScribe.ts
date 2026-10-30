import { Router } from 'express'
import * as aiScribeController from '../controllers/aiScribeController'
import { protect, authorize } from '../middleware/auth'
import { audioUpload } from '../config/audioUpload'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'
import { validateRequest } from '../middleware/validateRequest'
import { approveSessionSchema } from '../validation/rxCartSchemas'
import {
  attestConsentSchema,
  emptyBodySchema,
  sessionIdParamSchema,
  startSessionSchema,
  updateDraftSchema,
  visitRecordIdParamSchema,
} from '../validation/aiScribeSchemas'

const router = Router()

router.use(protect)
router.use(requireClinic)

const params = validateRequest({ params: sessionIdParamSchema })
const empty = validateRequest({ params: sessionIdParamSchema, body: emptyBodySchema })

router.get('/capabilities', authorize(Role.PROVIDER), aiScribeController.getCapabilities)

router.post(
  '/session/start',
  authorize(Role.PROVIDER),
  validateRequest({ body: startSessionSchema }),
  aiScribeController.startSession
)

router.get(
  '/session/visit/:visitRecordId',
  authorize(Role.PROVIDER),
  validateRequest({ params: visitRecordIdParamSchema }),
  aiScribeController.getByVisitRecord
)

router.get(
  '/session/:id/status',
  authorize(Role.PROVIDER),
  params,
  aiScribeController.getSessionStatus
)

router.get(
  '/session/:id/longitudinal',
  authorize(Role.PROVIDER),
  params,
  aiScribeController.getLongitudinal
)

router.get('/session/:id', authorize(Role.PROVIDER), params, aiScribeController.getSession)

router.post(
  '/session/:id/consent',
  authorize(Role.PROVIDER),
  validateRequest({ params: sessionIdParamSchema, body: attestConsentSchema }),
  aiScribeController.attestConsent
)

router.post(
  '/session/:id/audio',
  authorize(Role.PROVIDER),
  params,
  audioUpload.single('audio'),
  aiScribeController.uploadAudio
)

router.post('/session/:id/process', authorize(Role.PROVIDER), empty, aiScribeController.process)

router.post('/session/:id/simulate', authorize(Role.PROVIDER), empty, aiScribeController.simulate)

router.put(
  '/session/:id/draft',
  authorize(Role.PROVIDER),
  validateRequest({ params: sessionIdParamSchema, body: updateDraftSchema }),
  aiScribeController.updateDraft
)

router.post(
  '/session/:id/regenerate',
  authorize(Role.PROVIDER),
  empty,
  aiScribeController.regenerateDraft
)

router.post(
  '/session/:id/approve',
  authorize(Role.PROVIDER),
  validateRequest({ params: sessionIdParamSchema, body: approveSessionSchema }),
  aiScribeController.approve
)

router.post(
  '/session/:id/publish-summary',
  authorize(Role.PROVIDER),
  empty,
  aiScribeController.publishPatientSummary
)

export default router

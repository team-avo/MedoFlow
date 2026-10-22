import { Router } from 'express'
import * as aiScribeController from '../controllers/aiScribeController'
import { protect, authorize } from '../middleware/auth'
import { audioUpload } from '../config/audioUpload'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'
import { validateRequest } from '../middleware/validateRequest'
import { approveSessionSchema } from '../validation/rxCartSchemas'

const router = Router()

router.use(protect)
router.use(requireClinic)

router.post('/session/start', authorize(Role.PROVIDER), aiScribeController.startSession)

router.get(
  '/session/visit/:visitRecordId',
  authorize(Role.PROVIDER),
  aiScribeController.getByVisitRecord
)

router.get('/session/:id/status', authorize(Role.PROVIDER), aiScribeController.getSessionStatus)

router.get('/session/:id', authorize(Role.PROVIDER), aiScribeController.getSession)

router.post(
  '/session/:id/audio',
  authorize(Role.PROVIDER),
  audioUpload.single('audio'),
  aiScribeController.uploadAudio
)

router.post('/session/:id/process', authorize(Role.PROVIDER), aiScribeController.process)

router.post('/session/:id/simulate', authorize(Role.PROVIDER), aiScribeController.simulate)

router.put('/session/:id/draft', authorize(Role.PROVIDER), aiScribeController.updateDraft)

router.post('/session/:id/regenerate', authorize(Role.PROVIDER), aiScribeController.regenerateDraft)

router.post(
  '/session/:id/approve',
  authorize(Role.PROVIDER),
  validateRequest({ body: approveSessionSchema }),
  aiScribeController.approve
)

router.post(
  '/session/:id/publish-summary',
  authorize(Role.PROVIDER),
  aiScribeController.publishPatientSummary
)

export default router

import { Router } from 'express'
import * as consultationController from '../controllers/consultationController'
import { protect, authorize, optionalProtect } from '../middleware/auth'
import { audioUpload } from '../config/audioUpload'
import { requireClinic } from '../middleware/requireClinic'
import { Role } from '@prisma/client'

const router = Router()

// --- Public routes (optional auth) ---
router.get('/join/:token', optionalProtect, consultationController.joinByToken)

// Public: get video token using the join token (for patients who may not be fully authenticated)
router.get(
  '/join/:token/video-token',
  optionalProtect,
  consultationController.getVideoTokenByJoinToken
)

// --- All below require authentication ---
router.use(protect)

// --- Start consultation from appointment (provider only, needs clinic) ---
router.get(
  '/appointment/:appointmentId',
  authorize(Role.PROVIDER, Role.PATIENT),
  consultationController.getByAppointment
)

// --- Patient consent ---
router.post('/:id/consent', authorize(Role.PATIENT), consultationController.grantConsent)

router.post('/:id/consent/decline', authorize(Role.PATIENT), consultationController.declineConsent)

// --- Provider recording controls ---
router.post(
  '/:id/recording/start',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.startRecording
)

router.post(
  '/:id/recording/stop',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.stopRecording
)

router.post(
  '/:id/recording/upload',
  requireClinic,
  authorize(Role.PROVIDER),
  audioUpload.single('audio'),
  consultationController.uploadRecording
)

// --- Transcription ---
router.post(
  '/:id/transcribe',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.startTranscription
)

router.get(
  '/:id/transcript',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.getTranscript
)

// --- Convert to template ---
router.post(
  '/:id/convert-to-template',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.convertToTemplate
)

// --- Daily.co Video Room ---
router.post(
  '/:id/video-room',
  requireClinic,
  authorize(Role.PROVIDER),
  consultationController.createVideoRoom
)

router.get(
  '/:id/video-token',
  authorize(Role.PROVIDER, Role.PATIENT),
  consultationController.getVideoToken
)

// --- Get session by ID (provider or patient) ---
router.get('/:id', authorize(Role.PROVIDER, Role.PATIENT), consultationController.getSession)

export default router

// Separate router for appointment-scoped start
export const appointmentConsultationRouter = Router()
appointmentConsultationRouter.use(protect)
appointmentConsultationRouter.use(requireClinic)

appointmentConsultationRouter.post(
  '/:id/consultation/start',
  authorize(Role.PROVIDER),
  consultationController.startSession
)

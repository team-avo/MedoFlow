import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { clinicScope, withTenantBypass } from '../config/tenantContext'
import * as jaasService from '../services/jaasService'
import * as consultationService from '../services/consultationService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import { logRead } from '../services/auditService'
import { Role } from '@prisma/client'

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

async function providerScope(req: Request): Promise<{ providerId: string; clinicId: string }> {
  const user = req.user
  if (!user) {
    const err = new Error('Authentication required') as ApiError
    err.statusCode = 401
    throw err
  }
  const clinicId =
    (req.body as { clinicId?: string } | undefined)?.clinicId ||
    (req.query?.clinicId as string) ||
    user.clinicId
  if (!clinicId) {
    const err = new Error('Clinic context required') as ApiError
    err.statusCode = 400
    throw err
  }
  const provider = await prisma.provider.findFirst({
    where: { userId: user.id, clinicId },
  })
  if (!provider) {
    const err = new Error('Provider not found for this clinic') as ApiError
    err.statusCode = 403
    throw err
  }
  return { providerId: provider.id, clinicId }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /appointments/:id/consultation/start */
export const startSession = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const appointmentId = req.params.id as string
    if (!appointmentId) {
      const err = new Error('Appointment ID required') as ApiError
      err.statusCode = 400
      throw err
    }
    const session = await consultationService.createOrGetSession(
      appointmentId,
      providerId,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Consultation session ready', { session })
  }
)

/** GET /consultations/:id */
export const getSession = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const session = await consultationService.getSessionById(
      sessionId,
      req.user!.id,
      req.user!.role
    )
    successResponse(res, 200, 'Session retrieved', { session })
  }
)

/** GET /consultations/join/:token */
export const joinByToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const token = req.params.token as string
    const session = await consultationService.getSessionByToken(token)
    successResponse(res, 200, 'Session retrieved', { session })
  }
)

/** GET /consultations/join/:token/video-token — Get room info via join token (for patients)
 *
 *  Mints a per-patient, non-moderator JaaS JWT so the patient can join the
 *  same room the provider created. The provider is always the moderator.
 */
export const getVideoTokenByJoinToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const joinToken = req.params.token as string

    // Join token is the capability (works without login), so resolve it cross-clinic.
    const session = await withTenantBypass('consultation.join_by_token', () =>
      prisma.consultationSession.findFirst({
        where: { joinToken },
        include: {
          patient: { select: { id: true, name: true, email: true } },
        },
      })
    )
    if (!session) {
      const err = new Error('Invalid or expired consultation link') as ApiError
      err.statusCode = 404
      throw err
    }
    if (!session.meetingRoomName || !session.meetingRoomUrl) {
      const err = new Error('No video room created yet') as ApiError
      err.statusCode = 400
      throw err
    }

    const room = jaasService.buildVideoRoom({
      roomName: session.meetingRoomName,
      user: {
        id: session.patient?.id ?? `patient-${session.id}`,
        name: session.patient?.name ?? 'Patient',
        email: session.patient?.email,
        moderator: false,
      },
    })

    successResponse(res, 200, 'Video room info', {
      domain: room.domain,
      roomUrl: room.roomUrl,
      roomName: room.roomName,
      jwt: room.jwt,
      jaasEnabled: jaasService.isJaasEnabled(),
    })
  }
)

/** GET /consultations/appointment/:appointmentId */
export const getByAppointment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const session = await consultationService.getSessionForAppointment(
      appointmentId,
      req.user!.id,
      req.user!.role
    )
    successResponse(res, 200, 'Session retrieved', { session })
  }
)

/** POST /consultations/:id/consent */
export const grantConsent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const session = await consultationService.grantConsent(sessionId, req.user!.id, req.user!.id)
    successResponse(res, 200, 'Consent granted', { session })
  }
)

/** POST /consultations/:id/consent/decline */
export const declineConsent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const session = await consultationService.declineConsent(sessionId, req.user!.id, req.user!.id)
    successResponse(res, 200, 'Consent declined', { session })
  }
)

/** POST /consultations/:id/recording/start */
export const startRecording = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId } = await providerScope(req)
    const sessionId = req.params.id as string
    const session = await consultationService.startRecording(sessionId, providerId, req.user!.id)
    successResponse(res, 200, 'Recording started', { session })
  }
)

/** POST /consultations/:id/recording/stop */
export const stopRecording = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId } = await providerScope(req)
    const sessionId = req.params.id as string
    const session = await consultationService.stopRecording(sessionId, providerId, req.user!.id)
    successResponse(res, 200, 'Recording stopped', { session })
  }
)

/** POST /consultations/:id/recording/upload */
export const uploadRecording = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const sessionId = req.params.id as string
    const file = (req as Express.Request & { file?: Express.Multer.File }).file
    if (!file) {
      const err = new Error('Audio file required') as ApiError
      err.statusCode = 400
      throw err
    }
    const session = await consultationService.uploadRecording(
      sessionId,
      providerId,
      clinicId,
      file.buffer,
      file.mimetype,
      file.originalname,
      req.user!.id
    )
    successResponse(res, 200, 'Recording uploaded', { session })
  }
)

/** POST /consultations/:id/transcribe */
export const startTranscription = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const sessionId = req.params.id as string
    const result = await consultationService.startTranscription(
      sessionId,
      providerId,
      clinicId,
      req.user!.id
    )
    successResponse(res, 200, 'Transcription started', result)
  }
)

/** GET /consultations/:id/transcript */
export const getTranscript = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const transcript = await consultationService.getTranscript(
      sessionId,
      req.user!.id,
      req.user!.role
    )
    await logRead(req, {
      entityType: 'ConsultationTranscript',
      entityId: transcript.sessionId,
      clinicId: req.user!.clinicId,
    })
    successResponse(res, 200, 'Transcript retrieved', transcript)
  }
)

/** POST /consultations/:id/convert-to-template */
export const convertToTemplate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const sessionId = req.params.id as string
    const result = await consultationService.convertToTemplate(sessionId, providerId, clinicId)
    successResponse(res, 200, 'Template conversion info', result)
  }
)

// ---------------------------------------------------------------------------
// Jitsi Video Room (free, no payment required)
// ---------------------------------------------------------------------------

/** POST /consultations/:id/video-room — Create a Jitsi room for the consultation
 *
 *  Uses Jitsi as a Service (8x8.vc) with JWT moderator tokens. The provider
 *  calling this endpoint is signed in as moderator; the patient gets a
 *  non-moderator token from the public /join/:token/video-token endpoint.
 *
 *  We always regenerate the room name when the prior session ended (so
 *  transcripts from the previous call don't collide) and on first creation.
 */
export const createVideoRoom = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { clinicId } = await providerScope(req)
    const sessionId = req.params.id as string

    const session = await prisma.consultationSession.findUnique({
      where: { id: sessionId, clinicId },
      include: {
        provider: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    if (!session) {
      const err = new Error('Consultation session not found') as ApiError
      err.statusCode = 404
      throw err
    }

    const isStale =
      session.status === 'ENDED' ||
      session.recordingStatus === 'STOPPED' ||
      session.recordingStatus === 'STORED'

    // If JaaS is now configured but the stored room name doesn't carry the
    // appId prefix, it was created against meet.jit.si and must be replaced.
    const jaasConfig = jaasService.getJaasConfig()
    const isWrongDomain =
      jaasConfig !== null &&
      !!session.meetingRoomName &&
      !session.meetingRoomName.startsWith(jaasConfig.appId + '/')

    const needsRoom = !session.meetingRoomName || isStale || isWrongDomain
    const roomName = needsRoom
      ? jaasService.generateRoomName(`MedoFlow-${sessionId.slice(0, 10)}`)
      : session.meetingRoomName!

    const providerName = session.provider
      ? `Dr. ${session.provider.firstName} ${session.provider.lastName}`
      : 'Provider'

    const room = jaasService.buildVideoRoom({
      roomName,
      user: {
        id: req.user!.id,
        name: providerName,
        email: req.user!.email,
        moderator: true,
      },
    })

    if (needsRoom) {
      await prisma.consultationSession.update({
        where: { id: sessionId, clinicId },
        data: {
          meetingRoomUrl: room.roomUrl,
          meetingRoomName: room.roomName,
          // Always reset recording so a fresh room gets a fresh recording slot.
          recordingStatus: 'NOT_STARTED' as const,
          recordingUrl: null,
          ...(isStale ? { status: 'READY' as const } : {}),
        },
      })
    }

    successResponse(res, 201, 'Video room ready', {
      domain: room.domain,
      roomUrl: room.roomUrl,
      roomName: room.roomName,
      jwt: room.jwt,
      jaasEnabled: jaasService.isJaasEnabled(),
    })
  }
)

/** GET /consultations/:id/video-token — Get room info for authenticated users
 *
 *  Same JWT shape as createVideoRoom, but doesn't create a room — useful
 *  when the provider refreshes their tab mid-call and needs to re-mount
 *  the iframe against the existing room. Moderator flag is based on role.
 */
export const getVideoToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string

    const session = await prisma.consultationSession.findUnique({
      where: { id: sessionId, ...clinicScope() },
    })
    if (!session) {
      const err = new Error('Consultation session not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (!session.meetingRoomName || !session.meetingRoomUrl) {
      const err = new Error('No video room created yet') as ApiError
      err.statusCode = 400
      throw err
    }

    const room = jaasService.buildVideoRoom({
      roomName: session.meetingRoomName,
      user: {
        id: req.user!.id,
        name: req.user!.name,
        email: req.user!.email,
        moderator: req.user!.role === Role.PROVIDER,
      },
    })

    successResponse(res, 200, 'Video room info', {
      domain: room.domain,
      roomUrl: room.roomUrl,
      roomName: room.roomName,
      jwt: room.jwt,
      jaasEnabled: jaasService.isJaasEnabled(),
    })
  }
)

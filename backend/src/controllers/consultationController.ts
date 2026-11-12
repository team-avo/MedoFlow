import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import * as jaasService from '../services/jaasService'
import * as consultationService from '../services/consultationService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import * as auditService from '../services/auditService'
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
 *  The link stops issuing tokens once it expires (410 token_expired) or the
 *  call has ended (410 consultation_ended).
 */
export const getVideoTokenByJoinToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!jaasService.isJaasEnabled()) throw jaasService.videoNotConfiguredError()
    // Same lookup and expiry rule as the join page (cross-clinic by design:
    // the join token is the capability).
    const session = (await consultationService.getSessionByToken(
      req.params.token as string
    )) as unknown as {
      id: string
      clinicId: string
      status: string
      meetingRoomName: string | null
      patient: { id: string; name: string | null } | null
    }
    if (CALL_CLOSED_STATUSES.has(session.status)) {
      throw apiError('This consultation has ended', 410, 'consultation_ended')
    }
    if (!jaasService.isOwnRoom(session.meetingRoomName)) {
      throw apiError('No video room created yet', 400, 'no_video_room')
    }

    const room = jaasService.buildVideoRoom({
      roomName: session.meetingRoomName!,
      user: {
        id: session.patient?.id ?? `patient-${session.id}`,
        name: jaasService.patientDisplayName(session.patient?.name),
        moderator: false,
      },
    })
    await logVideoToken(req, session, false, 'join_link')
    successResponse(res, 200, 'Video room info', videoRoomPayload(room))
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

/** POST /consultations/:id/consent/attest: the provider records verbal consent (in person). */
export const attestConsent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId } = await providerScope(req)
    const session = await consultationService.attestVerbalConsent(
      req.params.id as string,
      providerId,
      req.user!.id
    )
    successResponse(res, 200, 'Consent recorded', { session })
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

/** POST /consultations/:id/live-transcript — one live-caption segment (WS2). */
export const liveTranscript = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId } = await providerScope(req)
    const sessionId = req.params.id as string
    const file = (req as Express.Request & { file?: Express.Multer.File }).file
    if (!file) {
      const err = new Error('Audio segment required') as ApiError
      err.statusCode = 400
      throw err
    }
    const raw = Number((req.body as { segment?: string } | undefined)?.segment ?? 0)
    const segment = Number.isInteger(raw) && raw >= 0 && raw < 100_000 ? raw : 0
    const result = await consultationService.transcribeLiveSegment(
      sessionId,
      providerId,
      file.buffer,
      file.mimetype,
      segment
    )
    successResponse(res, 200, 'Live caption', result)
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
// Video calls (Jitsi as a Service, 8x8.vc)
// ---------------------------------------------------------------------------

/** After these states the call is over; a new call needs a new room. */
const CALL_CLOSED_STATUSES = new Set<string>(['ENDED', 'PROCESSING', 'TRANSCRIPT_READY'])

function apiError(message: string, statusCode: number, code?: string): ApiError {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

function videoRoomPayload(room: jaasService.VideoRoomResult) {
  return {
    domain: room.domain,
    roomUrl: room.roomUrl,
    roomName: room.roomName,
    jwt: room.jwt,
    jaasEnabled: true,
  }
}

/** One audit row per issued call token: ids and the moderator flag only. */
async function logVideoToken(
  req: Request,
  session: { id: string; clinicId: string },
  moderator: boolean,
  via: 'join_link' | 'session'
): Promise<void> {
  await auditService.logAudit({
    clinicId: session.clinicId,
    entityType: 'ConsultationSession',
    entityId: session.id,
    action: 'VIDEO_TOKEN_ISSUED',
    newValue: { moderator, via },
    performedById: req.user?.id ?? null,
    ...auditService.requestMeta(req),
  })
}

/** POST /consultations/:id/video-room — Create (or reuse) the call room
 *
 *  Only the session's own provider may open the room; they join as moderator.
 *  The patient gets a non-moderator token from /join/:token/video-token.
 *  A new room is made on first use and after a call has ended, so a new call
 *  never reuses the previous one's room or recording slot.
 */
export const createVideoRoom = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    if (!jaasService.isJaasEnabled()) throw jaasService.videoNotConfiguredError()
    const sessionId = req.params.id as string

    const session = await prisma.consultationSession.findUnique({
      where: { id: sessionId, clinicId },
      include: { provider: { select: { lastName: true } } },
    })
    if (!session || session.providerId !== providerId) {
      throw apiError('Consultation session not found', 404)
    }

    const isStale =
      CALL_CLOSED_STATUSES.has(session.status) ||
      session.recordingStatus === 'STOPPED' ||
      session.recordingStatus === 'STORED'
    // A room from another JaaS app (or the old meet.jit.si fallback) is replaced.
    const needsRoom = isStale || !jaasService.isOwnRoom(session.meetingRoomName)
    const roomName = needsRoom
      ? jaasService.generateRoomName(`MedoFlow-${sessionId.slice(0, 10)}`)
      : session.meetingRoomName!

    const room = jaasService.buildVideoRoom({
      roomName,
      user: {
        id: req.user!.id,
        name: jaasService.providerDisplayName(session.provider),
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
      await auditService.logAudit({
        clinicId,
        entityType: 'ConsultationSession',
        entityId: sessionId,
        action: 'VIDEO_ROOM_CREATED',
        performedById: req.user!.id,
        ...auditService.requestMeta(req),
      })
    }
    await logVideoToken(req, session, true, 'session')

    successResponse(res, 201, 'Video room ready', videoRoomPayload(room))
  }
)

/** GET /consultations/:id/video-token — Rejoin the existing room
 *
 *  For the session's own patient (participant) or the session's own provider
 *  (moderator), e.g. after a tab refresh mid-call. Anyone else gets 404, the
 *  same answer as for a session that does not exist.
 */
export const getVideoToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!jaasService.isJaasEnabled()) throw jaasService.videoNotConfiguredError()
    const sessionId = req.params.id as string
    const user = req.user!

    const session = await prisma.consultationSession.findUnique({
      where: { id: sessionId, ...clinicScope() },
      include: {
        provider: { select: { userId: true, lastName: true } },
        patient: { select: { name: true } },
      },
    })
    const isPatient = !!session && user.role === Role.PATIENT && session.patientId === user.id
    const isProvider =
      !!session && user.role === Role.PROVIDER && session.provider?.userId === user.id
    if (!session || !(isPatient || isProvider)) {
      throw apiError('Consultation session not found', 404)
    }
    if (CALL_CLOSED_STATUSES.has(session.status) && isPatient) {
      throw apiError('This consultation has ended', 410, 'consultation_ended')
    }
    if (!jaasService.isOwnRoom(session.meetingRoomName)) {
      throw apiError('No video room created yet', 400, 'no_video_room')
    }

    const room = jaasService.buildVideoRoom({
      roomName: session.meetingRoomName!,
      user: {
        id: user.id,
        name: isProvider
          ? jaasService.providerDisplayName(session.provider)
          : jaasService.patientDisplayName(session.patient?.name),
        moderator: isProvider,
      },
    })
    await logVideoToken(req, session, isProvider, 'session')

    successResponse(res, 200, 'Video room info', videoRoomPayload(room))
  }
)

import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import * as aiScribeService from '../services/aiScribeService'
import * as visitService from '../services/visitService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import { logRead, requestMeta } from '../services/auditService'
import { aiScribeQueue } from '../queues/aiScribeQueue'
import { scribeCapabilities } from '../services/ai/registry'

const providerScope = async (req: Request): Promise<{ providerId: string; clinicId: string }> => {
  const provider = await visitService.getProviderByUserId(req.user!.id)
  if (!provider) {
    const err = new Error('Provider profile not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const clinicId = req.user!.clinicId!
  if (!clinicId) {
    const err = new Error('Clinic ID is required') as ApiError
    err.statusCode = 400
    throw err
  }
  return { providerId: provider.id, clinicId }
}

const notFound = (): never => {
  const err = new Error('Session not found') as ApiError
  err.statusCode = 404
  throw err
}

/** Queue the processing job; a queue outage is a clean 503 and a FAILED session. */
async function enqueue(
  sessionId: string,
  clinicId: string,
  name: 'process' | 'regenerate-soap',
  regenerateSoapOnly = false
): Promise<void> {
  try {
    await aiScribeQueue.add(name, { sessionId, clinicId, regenerateSoapOnly })
  } catch {
    console.error('[AI Scribe] Failed to queue job: queue unavailable')
    await prisma.aIScribeSession.update({
      where: { id: sessionId, clinicId },
      data: { status: 'FAILED', errorMessage: 'Processing could not be started. Try again.' },
    })
    const apiErr = new Error('Processing could not be started. Try again.') as ApiError
    apiErr.statusCode = 503
    apiErr.code = 'integration_failed'
    throw apiErr
  }
}

/** Refuses AI work when the scribe is not configured (no point queueing a job that must fail). */
function assertAiAvailable(): void {
  if (!scribeCapabilities().available) {
    const err = new Error('The AI scribe is not configured on this server.') as ApiError
    err.statusCode = 503
    err.code = 'ai_not_configured'
    throw err
  }
}

/** The session plus whether this visit may be recorded (FR-1). */
async function withConsent<
  T extends {
    id: string
    clinicId: string
    consentSource: string | null
    visitRecord: { appointmentId: string }
  },
>(session: T) {
  const consent = await aiScribeService.getConsentState(session, session.visitRecord.appointmentId)
  return { ...session, consent }
}

/** GET /ai-scribe/capabilities — what the UI may offer. No hosts, URLs or keys. */
export const getCapabilities = (_req: Request, res: Response): void => {
  successResponse(res, 200, 'Capabilities retrieved', { capabilities: scribeCapabilities() })
}

export const startSession = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const { visitRecordId } = req.body as { visitRecordId: string }
    const created = await aiScribeService.createSession(
      visitRecordId,
      providerId,
      clinicId,
      req.user!.id
    )
    const session = await aiScribeService.getSessionById(created.id, providerId, clinicId)
    successResponse(res, 201, 'AI Scribe session started', {
      session: session ? await withConsent(session) : created,
    })
  }
)

/** POST /ai-scribe/session/:id/consent — provider attests verbal consent. */
export const attestConsent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { providerId, clinicId } = await providerScope(req)
    const { session, consent } = await aiScribeService.attestVerbalConsent(
      req.params.id as string,
      providerId,
      clinicId,
      req.user!.id,
      requestMeta(req)
    )
    successResponse(res, 200, 'Consent recorded', { session: { ...session, consent } })
  }
)

export const uploadAudio = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const sessionCheck = await aiScribeService.getSessionById(sessionId, providerId, clinicId)
    if (!sessionCheck) notFound()
    if (sessionCheck!.status === 'APPROVED') {
      const err = new Error('This session has already been finalized.') as ApiError
      err.statusCode = 400
      throw err
    }

    const file = req.file
    if (!file || !file.buffer) {
      const err = new Error('No audio file uploaded') as ApiError
      err.statusCode = 400
      throw err
    }

    const sizeLimit = 50 * 1024 * 1024 // 50MB
    const fileSize = file.size ?? file.buffer?.length ?? 0
    if (!file.mimetype?.toLowerCase().startsWith('audio/') || fileSize > sizeLimit) {
      const err = new Error('Invalid audio file.') as ApiError
      err.statusCode = 400
      throw err
    }
    assertAiAvailable()

    const session = await aiScribeService.uploadAudio(
      sessionId,
      providerId,
      clinicId,
      file.buffer,
      file.mimetype,
      file.originalname
    )
    await enqueue(sessionId, clinicId, 'process')

    successResponse(res, 200, 'Audio uploaded, processing started', { session })
  }
)

/** POST /ai-scribe/session/:id/process — retry processing the stored audio. */
export const process = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.getSessionById(sessionId, providerId, clinicId)
    if (!session) notFound()
    if (!session!.audioUrl && !session!.transcript) {
      const err = new Error('No audio to process') as ApiError
      err.statusCode = 400
      throw err
    }
    if (session!.status === 'APPROVED') {
      const err = new Error('This session has already been finalized.') as ApiError
      err.statusCode = 400
      throw err
    }
    assertAiAvailable()

    await prisma.aIScribeSession.update({
      where: { id: sessionId, clinicId },
      data: { status: 'TRANSCRIBING', errorMessage: null },
    })
    await enqueue(sessionId, clinicId, 'process')

    const updated = await aiScribeService.getSessionById(sessionId, providerId, clinicId)
    successResponse(res, 200, 'Processing started', { session: updated })
  }
)

export const simulate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.simulateSession(sessionId, providerId, clinicId)
    await logRead(req, { entityType: 'AIScribeSession', entityId: sessionId, clinicId })
    successResponse(res, 200, 'Session simulated successfully', { session })
  }
)

export const getSessionStatus = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.getSessionById(sessionId, providerId, clinicId)
    if (!session) notFound()
    const processingStartedAt = session!.processingStartedAt
    const processingCompletedAt = session!.processingCompletedAt
    const processingDuration =
      processingStartedAt && processingCompletedAt
        ? Math.round(
            (new Date(processingCompletedAt).getTime() - new Date(processingStartedAt).getTime()) /
              1000
          )
        : null

    successResponse(res, 200, 'Status retrieved', {
      status: session!.status,
      processingStartedAt,
      processingCompletedAt,
      processingDuration,
      // Safe, fixed texts only (services/ai/errors.ts).
      errorMessage: session!.errorMessage,
    })
  }
)

export const getSession = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.getSessionForProvider(sessionId, providerId, clinicId)
    if (!session) notFound()
    await logRead(req, { entityType: 'AIScribeSession', entityId: session!.id, clinicId })
    successResponse(res, 200, 'Session retrieved', { session: await withConsent(session!) })
  }
)

export const updateDraft = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)
    const { clinicId: _hint, ...edit } = req.body as aiScribeService.DraftEdit & {
      clinicId?: string
    }

    const session = await aiScribeService.updateDraft(
      sessionId,
      providerId,
      clinicId,
      edit,
      req.user!.id
    )
    await logRead(req, { entityType: 'AIScribeSession', entityId: sessionId, clinicId })
    successResponse(res, 200, 'Draft updated', { session })
  }
)

export const regenerateDraft = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.getSessionById(sessionId, providerId, clinicId)
    if (!session) notFound()
    if (!session!.transcript) {
      const err = new Error('No transcript to regenerate from') as ApiError
      err.statusCode = 400
      throw err
    }
    if (session!.status === 'APPROVED') {
      const err = new Error('This session has already been finalized.') as ApiError
      err.statusCode = 400
      throw err
    }
    assertAiAvailable()

    await prisma.aIScribeSession.update({
      where: { id: sessionId, clinicId },
      data: { status: 'TRANSCRIBING', errorMessage: null },
    })
    await enqueue(sessionId, clinicId, 'regenerate-soap', true)

    const updated = await aiScribeService.getSessionForProvider(sessionId, providerId, clinicId)
    successResponse(res, 200, 'Regeneration started', { session: updated })
  }
)

export const approve = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const { rxConfirmation, sendToPatient, draft, patientSummary } = (req.body ?? {}) as Pick<
      aiScribeService.ApproveOptions,
      'rxConfirmation' | 'sendToPatient' | 'draft' | 'patientSummary'
    >
    const session = await aiScribeService.approveDraft(
      sessionId,
      providerId,
      clinicId,
      req.user!.id,
      { rxConfirmation, sendToPatient, draft, patientSummary, ...requestMeta(req) }
    )
    const message = sendToPatient
      ? 'Note approved and sent to the patient'
      : rxConfirmation
        ? 'Note approved and products sent'
        : 'Note approved and finalized'
    successResponse(res, 200, message, { session })
  }
)

export const publishPatientSummary = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.publishPatientSummary(
      sessionId,
      providerId,
      clinicId,
      req.user!.id
    )
    successResponse(res, 200, 'Patient summary published', { session })
  }
)

export const getByVisitRecord = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const visitRecordId = req.params.visitRecordId as string
    const { providerId, clinicId } = await providerScope(req)

    const session = await aiScribeService.getSessionByVisitRecordId(
      visitRecordId,
      providerId,
      clinicId
    )
    if (session)
      await logRead(req, { entityType: 'AIScribeSession', entityId: session.id, clinicId })
    successResponse(res, 200, 'Session retrieved', {
      session: session ? await withConsent(session) : null,
    })
  }
)

/** GET /ai-scribe/session/:id/longitudinal — the patient's prior approved visits (FR-7). */
export const getLongitudinal = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const sessionId = req.params.id as string
    const { providerId, clinicId } = await providerScope(req)

    const visits = await aiScribeService.getLongitudinalForSession(sessionId, providerId, clinicId)
    for (const v of visits) {
      await logRead(req, { entityType: 'VisitRecord', entityId: v.visitRecordId, clinicId })
    }
    successResponse(res, 200, 'Longitudinal record retrieved', { visits })
  }
)

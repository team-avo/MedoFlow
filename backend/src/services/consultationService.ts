/**
 * Consultation Session Service
 * Manages the lifecycle of Medoflow-native consultation sessions.
 * Links to existing AIScribeSession for clinical pipeline (transcription, SOAP, approve, publish).
 */

import prisma from '../config/prisma'
import { clinicScope, withTenantBypass } from '../config/tenantContext'
import crypto from 'crypto'
import type { ApiError } from '../types/errors'
import { ConsultationStatus, RecordingStatus, ConsentStatus, Role } from '@prisma/client'
import * as auditService from './auditService'
import * as storageService from './storageService'
import * as aiScribeService from './aiScribeService'
import * as visitService from './visitService'

// ---------------------------------------------------------------------------
// State machine helpers
// ---------------------------------------------------------------------------

const VALID_SESSION_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ['READY'],
  READY: ['LIVE'],
  LIVE: ['RECORDING', 'ENDED'],
  RECORDING: ['ENDED', 'FAILED'],
  ENDED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['TRANSCRIPT_READY', 'FAILED'],
  TRANSCRIPT_READY: [],
  FAILED: ['READY'], // allow retry
}

const VALID_RECORDING_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ['RECORDING'],
  RECORDING: ['STOPPED', 'FAILED'],
  STOPPED: ['UPLOADING'],
  UPLOADING: ['STORED', 'FAILED'],
  STORED: [],
  FAILED: ['RECORDING'], // allow retry
}

export function isValidSessionTransition(from: string, to: string): boolean {
  return VALID_SESSION_TRANSITIONS[from]?.includes(to) ?? false
}

export function isValidRecordingTransition(from: string, to: string): boolean {
  return VALID_RECORDING_TRANSITIONS[from]?.includes(to) ?? false
}

function throwApi(message: string, statusCode: number, code?: string): never {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  if (code) err.code = code
  throw err
}

const JOIN_TOKEN_TTL_HOURS = 24

export function generateJoinToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function getJoinTokenExpiry(now = new Date()): Date {
  return new Date(now.getTime() + JOIN_TOKEN_TTL_HOURS * 60 * 60 * 1000)
}

export function isJoinTokenExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime()
}

const rotateJoinToken = async (sessionId: string, clinicId: string) => {
  return prisma.consultationSession.update({
    where: { id: sessionId, clinicId },
    data: {
      joinToken: generateJoinToken(),
      joinTokenExpiresAt: getJoinTokenExpiry(),
    },
    include: {
      appointment: { select: { id: true, startTime: true, endTime: true, meetLink: true } },
      patient: { select: { id: true, name: true, email: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  })
}

// ---------------------------------------------------------------------------
// Sanitization — strip sensitive fields for patient view
// ---------------------------------------------------------------------------

export function sanitizeForPatient(session: Record<string, unknown>) {
  const safe = { ...session }
  delete safe.transcriptText
  delete safe.aiScribeSessionId
  delete safe.aiScribeSession
  delete safe.errorMessage
  return safe
}

// ---------------------------------------------------------------------------
// Create / Get session
// ---------------------------------------------------------------------------

export const createOrGetSession = async (
  appointmentId: string,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  // Validate appointment exists and belongs to provider/clinic
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    include: { provider: true },
  })
  if (!appointment) {
    throwApi('Appointment not found', 404)
  }
  if (appointment.providerId !== providerId) {
    throwApi('Access denied — appointment belongs to another provider', 403, 'forbidden')
  }
  if (!['CONFIRMED', 'COMPLETED'].includes(appointment.status)) {
    throwApi(
      'Appointment must be confirmed or completed to start a consultation',
      400,
      'invalid_state'
    )
  }

  // Check if session already exists
  const existing = await prisma.consultationSession.findFirst({
    where: {
      appointmentId,
      clinicId,
      status: { not: ConsultationStatus.FAILED },
    },
    include: {
      appointment: { select: { id: true, startTime: true, endTime: true, meetLink: true } },
      patient: { select: { id: true, name: true, email: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  if (existing) {
    if (isJoinTokenExpired(existing.joinTokenExpiresAt)) {
      return rotateJoinToken(existing.id, clinicId)
    }
    return existing
  }

  // Create new session — pre-grant consent if the patient opted in while
  // booking. The appointment carries `aiScribeConsentGrantedAt` when so.
  const preGrantedAt = appointment.aiScribeConsentGrantedAt ?? null
  const session = await prisma.consultationSession.create({
    data: {
      clinicId,
      appointmentId,
      providerId,
      patientId: appointment.patientId,
      status: ConsultationStatus.READY,
      joinToken: generateJoinToken(),
      joinTokenExpiresAt: getJoinTokenExpiry(),
      consentStatus: preGrantedAt ? ConsentStatus.GRANTED : ConsentStatus.PENDING,
      consentGrantedAt: preGrantedAt,
    },
    include: {
      appointment: { select: { id: true, startTime: true, endTime: true, meetLink: true } },
      patient: { select: { id: true, name: true, email: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'ConsultationSession',
    entityId: session.id,
    action: 'CONSULTATION_SESSION_CREATED',
    performedById,
  })

  return session
}

// ---------------------------------------------------------------------------
// Retrieve
// ---------------------------------------------------------------------------

export const getSessionById = async (sessionId: string, userId: string, role: Role) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
    include: {
      appointment: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          meetLink: true,
        },
      },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true } },
      aiScribeSession: {
        select: {
          id: true,
          status: true,
          transcript: true,
          aiDraft: true,
          patientSummary: true,
          patientSummaryPublished: true,
          errorMessage: true,
        },
      },
    },
  })

  if (!session) throwApi('Consultation session not found', 404)

  // Access control
  if (role === Role.PATIENT) {
    if (session.patientId !== userId) {
      throwApi('Access denied', 403, 'forbidden')
    }
    return sanitizeForPatient(session as unknown as Record<string, unknown>)
  }

  // Provider: must be the session's provider or same clinic
  const provider = await prisma.provider.findFirst({
    where: { userId, clinicId: session.clinicId },
  })
  if (!provider || provider.id !== session.providerId) {
    throwApi('Access denied', 403, 'forbidden')
  }

  return session
}

export const getSessionByToken = async (joinToken: string) => {
  // The join token is the capability (anonymous patients join with it alone),
  // so the lookup is cross-clinic by design — also for logged-in callers.
  const session = await withTenantBypass('consultation.join_by_token', () =>
    prisma.consultationSession.findUnique({
      where: { joinToken },
      include: {
        appointment: {
          select: { id: true, startTime: true, endTime: true, status: true, meetLink: true },
        },
        provider: { select: { firstName: true, lastName: true } },
        patient: { select: { id: true, name: true } },
      },
    })
  )
  if (!session) throwApi('Invalid or expired consultation link', 404)
  if (isJoinTokenExpired(session.joinTokenExpiresAt)) {
    throwApi('Consultation link has expired', 410, 'token_expired')
  }
  return sanitizeForPatient(session as unknown as Record<string, unknown>)
}

export const getSessionForAppointment = async (
  appointmentId: string,
  userId: string,
  role: Role
) => {
  const session = await prisma.consultationSession.findFirst({
    where: { appointmentId, ...clinicScope() },
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: {
        select: { id: true, startTime: true, endTime: true, status: true, meetLink: true },
      },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true } },
    },
  })
  if (!session) return null

  if (role === Role.PATIENT) {
    if (session.patientId !== userId) {
      throwApi('Access denied', 403, 'forbidden')
    }
    return sanitizeForPatient(session as unknown as Record<string, unknown>)
  }

  const provider = await prisma.provider.findFirst({
    where: { userId, clinicId: session.clinicId },
  })
  if (!provider || provider.id !== session.providerId) {
    throwApi('Access denied', 403, 'forbidden')
  }

  return session
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export const grantConsent = async (sessionId: string, userId: string, performedById: string) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
  })
  if (!session) throwApi('Session not found', 404)

  // Only the patient can grant consent
  if (session.patientId !== userId) {
    throwApi('Only the patient can grant consent', 403, 'forbidden')
  }
  if (session.consentStatus === ConsentStatus.GRANTED) {
    return session // already granted
  }
  if (session.status === ConsultationStatus.ENDED || session.status === ConsultationStatus.FAILED) {
    throwApi('Session has ended', 400, 'invalid_state')
  }

  const updated = await prisma.consultationSession.update({
    where: { id: sessionId, clinicId: session.clinicId },
    data: {
      consentStatus: ConsentStatus.GRANTED,
      consentGrantedAt: new Date(),
    },
  })

  await auditService.logAudit({
    clinicId: session.clinicId,
    entityType: 'ConsultationSession',
    entityId: sessionId,
    action: 'CONSENT_GRANTED',
    performedById,
  })

  return updated
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

export const startRecording = async (
  sessionId: string,
  providerId: string,
  performedById: string
) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
  })
  if (!session) throwApi('Session not found', 404)
  if (session.providerId !== providerId) throwApi('Access denied', 403, 'forbidden')

  // Consent must be granted
  if (session.consentStatus !== ConsentStatus.GRANTED) {
    throwApi('Recording cannot start — patient consent is required', 400, 'consent_required')
  }

  // Validate session state — must be READY or LIVE
  const sessionStatus = session.status as string
  if (sessionStatus !== 'READY' && sessionStatus !== 'LIVE') {
    throwApi(`Cannot start recording in session state: ${session.status}`, 400, 'invalid_state')
  }

  // Validate recording state
  const recStatus = session.recordingStatus as string
  if (recStatus !== 'NOT_STARTED' && recStatus !== 'FAILED') {
    throwApi(
      `Cannot start recording in recording state: ${session.recordingStatus}`,
      400,
      'invalid_state'
    )
  }

  const updated = await prisma.consultationSession.update({
    where: { id: sessionId, clinicId: session.clinicId },
    data: {
      status: ConsultationStatus.RECORDING,
      recordingStatus: RecordingStatus.RECORDING,
      startedAt: session.startedAt ?? new Date(),
    },
  })

  await auditService.logAudit({
    clinicId: session.clinicId,
    entityType: 'ConsultationSession',
    entityId: sessionId,
    action: 'RECORDING_STARTED',
    performedById,
  })

  return updated
}

export const stopRecording = async (
  sessionId: string,
  providerId: string,
  performedById: string
) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
  })
  if (!session) throwApi('Session not found', 404)
  if (session.providerId !== providerId) throwApi('Access denied', 403, 'forbidden')

  if (session.recordingStatus !== RecordingStatus.RECORDING) {
    throwApi('Recording is not in progress', 400, 'invalid_state')
  }

  const updated = await prisma.consultationSession.update({
    where: { id: sessionId, clinicId: session.clinicId },
    data: {
      status: ConsultationStatus.ENDED,
      recordingStatus: RecordingStatus.STOPPED,
      endedAt: new Date(),
    },
  })

  await auditService.logAudit({
    clinicId: session.clinicId,
    entityType: 'ConsultationSession',
    entityId: sessionId,
    action: 'RECORDING_STOPPED',
    performedById,
  })

  return updated
}

// ---------------------------------------------------------------------------
// Upload recording
// ---------------------------------------------------------------------------

export const uploadRecording = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  buffer: Buffer,
  mimeType: string,
  originalName?: string,
  performedById?: string
) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, clinicId },
  })
  if (!session) throwApi('Session not found', 404)
  if (session.providerId !== providerId) throwApi('Access denied', 403, 'forbidden')
  if (session.clinicId !== clinicId) throwApi('Access denied', 403, 'forbidden')

  const recStatus = session.recordingStatus as string
  if (recStatus !== 'STOPPED' && recStatus !== 'FAILED' && recStatus !== 'RECORDING') {
    throwApi('Recording must be stopped before upload', 400, 'invalid_state')
  }

  // If still in RECORDING state (e.g. screen-share ended natively), auto-stop first
  if (recStatus === 'RECORDING') {
    await prisma.consultationSession.update({
      where: { id: sessionId, clinicId },
      data: {
        status: ConsultationStatus.ENDED,
        recordingStatus: RecordingStatus.STOPPED,
        endedAt: new Date(),
      },
    })
  }

  // Transition to UPLOADING
  await prisma.consultationSession.update({
    where: { id: sessionId, clinicId },
    data: { recordingStatus: RecordingStatus.UPLOADING },
  })

  try {
    const audioUrl = await storageService.uploadAudio({
      sessionId,
      buffer,
      mimeType,
      originalName,
    })

    const updated = await prisma.consultationSession.update({
      where: { id: sessionId, clinicId },
      data: {
        recordingUrl: audioUrl,
        recordingStatus: RecordingStatus.STORED,
      },
    })

    await auditService.logAudit({
      clinicId,
      entityType: 'ConsultationSession',
      entityId: sessionId,
      action: 'RECORDING_UPLOADED',
      performedById: performedById || providerId,
    })

    return updated
  } catch (err) {
    await prisma.consultationSession.update({
      where: { id: sessionId, clinicId },
      data: {
        recordingStatus: RecordingStatus.FAILED,
        errorMessage: err instanceof Error ? err.message : 'Upload failed',
      },
    })
    throwApi('Failed to upload recording', 500, 'upload_failed')
  }
}

// ---------------------------------------------------------------------------
// Transcription — bridge to existing AI Scribe pipeline
// ---------------------------------------------------------------------------

export const startTranscription = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, clinicId },
    include: {
      appointment: { select: { id: true, patientId: true, serviceId: true } },
    },
  })
  if (!session) throwApi('Session not found', 404)
  if (session.providerId !== providerId) throwApi('Access denied', 403, 'forbidden')

  if (session.recordingStatus !== RecordingStatus.STORED) {
    throwApi('Recording must be uploaded before transcription', 400, 'recording_missing')
  }

  if (!session.recordingUrl) {
    throwApi('No recording URL found', 400, 'recording_missing')
  }

  // Create or get VisitRecord for this appointment
  const existingVisitRecord = await visitService.getVisitRecordByAppointment(
    session.appointmentId,
    clinicId
  )
  let visitRecordId: string
  if (existingVisitRecord) {
    visitRecordId = existingVisitRecord.id
  } else {
    const newVisitRecord = await visitService.createVisitRecord(
      { appointmentId: session.appointmentId, patientId: session.patientId },
      providerId,
      clinicId,
      performedById
    )
    if (!newVisitRecord) throwApi('Failed to create visit record', 500)
    visitRecordId = newVisitRecord.id
  }

  // Create AIScribeSession — this is the bridge to existing pipeline
  const aiSession = await aiScribeService.createSession(visitRecordId, providerId, clinicId)

  // Upload the recording URL to the AI scribe session
  // We need to fetch the buffer from storage and pass to aiScribe
  const buffer = await storageService.getAudioBufferFromRef(session.recordingUrl)
  await aiScribeService.uploadAudio(aiSession.id, providerId, clinicId, buffer, 'audio/webm')

  // Link consultation session to AI scribe session
  const updated = await prisma.consultationSession.update({
    where: { id: sessionId, clinicId },
    data: {
      aiScribeSessionId: aiSession.id,
      status: ConsultationStatus.PROCESSING,
      transcriptStatus: 'PROCESSING',
    },
  })

  // Add to AI Scribe Queue to trigger background worker
  const { aiScribeQueue } = await import('../queues/aiScribeQueue')
  await aiScribeQueue.add('process', { sessionId: aiSession.id })

  await auditService.logAudit({
    clinicId,
    entityType: 'ConsultationSession',
    entityId: sessionId,
    action: 'TRANSCRIPTION_STARTED',
    performedById,
  })

  return { session: updated, aiScribeSessionId: aiSession.id }
}

// ---------------------------------------------------------------------------
// Transcript retrieval
// ---------------------------------------------------------------------------

export const getTranscript = async (sessionId: string, userId: string, role: Role) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
    include: {
      aiScribeSession: {
        select: {
          id: true,
          transcript: true,
          status: true,
          aiDraft: true,
          timeline: true,
          errorMessage: true,
        },
      },
    },
  })
  if (!session) throwApi('Session not found', 404)

  // Patients cannot see transcript
  if (role === Role.PATIENT) {
    throwApi('Transcript is not available to patients', 403, 'forbidden')
  }

  // Provider access check
  const provider = await prisma.provider.findFirst({
    where: { userId, clinicId: session.clinicId },
  })
  if (!provider || provider.id !== session.providerId) {
    throwApi('Access denied', 403, 'forbidden')
  }

  return {
    sessionId: session.id,
    transcriptStatus: session.transcriptStatus,
    transcript: session.aiScribeSession?.transcript ?? session.transcriptText,
    aiScribeStatus: session.aiScribeSession?.status ?? null,
    aiDraft: session.aiScribeSession?.aiDraft ?? null,
    timeline: session.aiScribeSession?.timeline ?? null,
    errorMessage: session.aiScribeSession?.errorMessage ?? session.errorMessage,
  }
}

// ---------------------------------------------------------------------------
// Convert to template — delegates to existing AI scribe flow
// ---------------------------------------------------------------------------

export const convertToTemplate = async (
  sessionId: string,
  providerId: string,
  clinicId: string
) => {
  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId, clinicId },
    include: {
      aiScribeSession: { select: { id: true, status: true } },
    },
  })
  if (!session) throwApi('Session not found', 404)
  if (session.providerId !== providerId) throwApi('Access denied', 403, 'forbidden')

  if (!session.aiScribeSessionId) {
    throwApi('Transcription has not been started', 400, 'transcript_missing')
  }

  // The AI scribe session must have a draft
  const aiSession = session.aiScribeSession
  if (!aiSession) {
    throwApi('AI Scribe session not found', 404)
  }

  // Return the AI scribe session ID so the frontend can use existing scribe flow
  return {
    aiScribeSessionId: session.aiScribeSessionId,
    aiScribeStatus: aiSession.status,
  }
}

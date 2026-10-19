/**
 * AI Scribe service - session management, audio upload, transcript processing,
 * SOAP draft generation, and approval flow.
 * Structured for future extensions: live transcription, multiple recordings, real-time AI.
 */

import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { AIScribeStatus } from '@prisma/client'
import * as visitService from './visitService'
import * as storageService from './storageService'
import * as auditService from './auditService'
import * as openaiService from './openaiService'
import * as rxCartService from './rxCartService'
import type { ScribeOrder } from './rxMappingService'

export interface SoapDraft {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export interface PatientSummary {
  diagnosis?: string
  treatmentPlan?: string
  nextSteps?: string
}

export const createSession = async (
  visitRecordId: string,
  providerId: string,
  clinicId: string
) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiEnabled: true },
  })
  if (clinic?.aiEnabled === false) {
    const err = new Error('AI Scribe is not enabled for this clinic') as ApiError
    err.statusCode = 403
    err.code = 'ai_disabled'
    throw err
  }
  const visitRecord = await visitService.getVisitRecordById(visitRecordId, {
    clinicId,
  })
  if (!visitRecord) {
    const err = new Error('Visit record not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (visitRecord.providerId !== providerId) {
    const err = new Error('Access denied') as ApiError
    err.statusCode = 403
    throw err
  }
  if ((visitRecord as { isFinalized?: boolean }).isFinalized) {
    const err = new Error('Visit record is finalized') as ApiError
    err.statusCode = 400
    throw err
  }

  const session = await prisma.aIScribeSession.create({
    data: {
      visitRecordId,
      providerId,
      clinicId,
      status: AIScribeStatus.RECORDING,
    },
    include: {
      visitRecord: { select: { id: true, appointmentId: true } },
    },
  })
  return session
}

export const simulateSession = async (sessionId: string, providerId: string, clinicId: string) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const mockTranscript = `
Provider: Hello Emma, how are you feeling today after your last session?
Patient: I'm doing better, but my lower back is still quite stiff in the mornings.
Provider: I see. Does the stiffness go away after you start moving, or does it persist throughout the day?
Patient: It usually gets better after about 30 minutes of walking around, but if I sit for too long at work, it comes back.
Provider: Understood. Let's take a look at your range of motion today. Please lean forward... Okay, there's some restriction in the lumbar region.
Patient: Yeah, right there is where it feels tight.
Provider: We'll continue with the manual therapy we started last week, but I also want to add some specific core stabilization exercises to your home program.
Patient: That sounds good. I've been doing the stretches you gave me.
Provider: Great. Let's aim for 3 sets of 10 repetitions for the new exercises, twice a day. I'll see you again in 4 days.
Provider: For the muscle tension, take magnesium glycinate 400 mg at night, two bottles should last until next month, and use arnica gel on the sore area. I'm also writing tramadol 50 mg for the bad nights, and try a turmeric complex.
  `.trim()

  // Orders the scribe would extract from this conversation (B5.1).
  const mockOrders: ScribeOrder[] = [
    { name: 'Magnesium glycinate 400 mg', quantity: 2 },
    { name: 'Arnica gel', quantity: 1 },
    { name: 'Tramadol 50 mg', quantity: 1 },
    { name: 'Turmeric complex', quantity: 1 },
  ]

  const mockSoap: SoapDraft = {
    subjective:
      'Patient reports morning stiffness in the lower back that improves after 30 minutes of activity but recurs with prolonged sitting. Patient has been compliant with previously prescribed stretches.',
    objective:
      'Physical exam reveals restricted lumbar range of motion during forward flexion. Palpation identifies tightness in the paraspinal muscles.',
    assessment:
      'Progressing well with rehab for lumbar strain. Stiffness indicates a need for increased core stability to support spinal alignment during sedentary work.',
    plan: '1. Manual therapy (myofascial release) to lumbar region. 2. Added core stabilization exercises (Dead Bug and Bird-Dog) to HEP: 3x10, twice daily. 3. Follow-up appointment in 4 days.',
  }

  const updated = await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: {
      status: AIScribeStatus.DRAFT_GENERATED,
      transcript: mockTranscript,
      aiDraft: mockSoap as object,
      processingStartedAt: new Date(),
      processingCompletedAt: new Date(),
    },
  })

  await rxCartService.upsertProposalForSession(sessionId, clinicId, mockOrders)

  return updated
}

export const uploadAudio = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  buffer: Buffer,
  mimeType: string,
  originalName?: string
) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (session.status !== AIScribeStatus.RECORDING && session.status !== AIScribeStatus.FAILED) {
    const err = new Error('Session is not in recording state') as ApiError
    err.statusCode = 400
    throw err
  }

  const audioUrl = await storageService.uploadAudio({
    sessionId,
    buffer,
    mimeType,
    originalName,
  })

  const updated = await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: {
      audioUrl,
      status: AIScribeStatus.TRANSCRIBING,
      errorMessage: null,
    },
    include: {
      visitRecord: { select: { id: true, appointmentId: true } },
    },
  })
  return updated
}

export const getSessionById = async (sessionId: string, providerId: string, clinicId: string) => {
  return prisma.aIScribeSession.findFirst({
    where: {
      id: sessionId,
      providerId,
      clinicId,
    },
    include: {
      visitRecord: {
        select: {
          id: true,
          appointmentId: true,
          patientId: true,
          isFinalized: true,
          currentVersion: true,
        },
      },
      provider: { select: { userId: true } },
    },
  })
}

export const getSessionForProvider = async (
  sessionId: string,
  providerId: string,
  clinicId: string
) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) return null
  return session
}

export const updateTranscript = async (sessionId: string, transcript: string) => {
  return prisma.aIScribeSession.update({
    where: { id: sessionId, ...clinicScope() },
    data: { transcript },
  })
}

export const updateAiDraft = async (sessionId: string, aiDraft: SoapDraft) => {
  return prisma.aIScribeSession.update({
    where: { id: sessionId, ...clinicScope() },
    data: {
      aiDraft: aiDraft as object,
      status: AIScribeStatus.DRAFT_GENERATED,
    },
  })
}

export const getVisitRecordForSession = async (sessionId: string) => {
  const session = await prisma.aIScribeSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
    include: {
      visitRecord: true,
    },
  })
  return session?.visitRecord ?? null
}

export const saveDraftAsVisitNoteVersion = async (sessionId: string, draft: SoapDraft) => {
  const session = await prisma.aIScribeSession.findUnique({
    where: { id: sessionId, ...clinicScope() },
    include: { visitRecord: true, provider: { select: { userId: true } } },
  })
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const userId = session.provider.userId
  if (!userId) {
    const err = new Error('Provider has no user account') as ApiError
    err.statusCode = 400
    throw err
  }

  const version = await prisma.visitNoteVersion.create({
    data: {
      visitRecordId: session.visitRecordId,
      subjective: draft.subjective,
      objective: draft.objective,
      assessment: draft.assessment,
      plan: draft.plan,
      createdById: userId,
    },
  })

  await prisma.visitRecord.update({
    where: { id: session.visitRecordId, clinicId: session.clinicId },
    data: {
      currentVersionId: version.id,
      subjective: draft.subjective,
      objective: draft.objective,
      assessment: draft.assessment,
      plan: draft.plan,
    },
  })

  await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId: session.clinicId },
    data: { status: AIScribeStatus.DRAFT_GENERATED },
  })

  return version
}

export const updateDraft = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  draft: Partial<SoapDraft>
) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (
    session.status !== AIScribeStatus.DRAFT_GENERATED &&
    session.status !== AIScribeStatus.EDITED
  ) {
    const err = new Error('Draft not available for editing') as ApiError
    err.statusCode = 400
    throw err
  }

  const currentDraft = (session.aiDraft as unknown as SoapDraft) || {}
  const merged: SoapDraft = {
    subjective: draft.subjective ?? currentDraft.subjective ?? '',
    objective: draft.objective ?? currentDraft.objective ?? '',
    assessment: draft.assessment ?? currentDraft.assessment ?? '',
    plan: draft.plan ?? currentDraft.plan ?? '',
  }

  return prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: {
      aiDraft: merged as object,
      status: AIScribeStatus.EDITED,
    },
  })
}

export interface ApproveOptions {
  /** "Approve & send": the provider's explicit confirmation of the detected products (B5.2). */
  rxConfirmation?: { proposalId: string } & rxCartService.RxConfirmation
  ipAddress?: string | null
  userAgent?: string | null
}

export const approveDraft = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  performedById: string,
  options: ApproveOptions = {}
) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (
    session.status !== AIScribeStatus.DRAFT_GENERATED &&
    session.status !== AIScribeStatus.EDITED
  ) {
    const err = new Error('Draft must be ready before approval') as ApiError
    err.statusCode = 400
    throw err
  }

  const draft = session.aiDraft as unknown as SoapDraft
  if (!draft?.subjective && !draft?.objective && !draft?.assessment && !draft?.plan) {
    const err = new Error('No draft content to approve') as ApiError
    err.statusCode = 400
    throw err
  }

  const provider = await visitService.getProviderByUserId(performedById)
  if (!provider || session.providerId !== provider.id) {
    const err = new Error('Provider not found or access denied') as ApiError
    err.statusCode = 403
    throw err
  }

  const patientSummary = await openaiService.generatePatientSummary(draft)

  const formattedNote = [
    'Subjective:',
    draft.subjective ?? '',
    '',
    'Objective:',
    draft.objective ?? '',
    '',
    'Assessment:',
    draft.assessment ?? '',
    '',
    'Plan:',
    draft.plan ?? '',
  ].join('\n')

  const rx = options.rxConfirmation
  if (rx) {
    const proposal = await rxCartService.getProposalForSession(sessionId, providerId, clinicId)
    if (!proposal || proposal.id !== rx.proposalId) {
      const err = new Error('Proposal not found for this session') as ApiError
      err.statusCode = 404
      throw err
    }
  }

  const rxResult = await prisma.$transaction(async (tx) => {
    const version = await tx.visitNoteVersion.create({
      data: {
        visitRecordId: session.visitRecordId,
        subjective: draft.subjective,
        objective: draft.objective,
        assessment: draft.assessment,
        plan: draft.plan,
        createdById: performedById,
      },
    })

    await tx.visitRecord.update({
      where: { id: session.visitRecordId, clinicId },
      data: {
        currentVersionId: version.id,
        subjective: draft.subjective,
        objective: draft.objective,
        assessment: draft.assessment,
        plan: draft.plan,
        note: formattedNote,
        status: 'FINAL',
        isFinalized: true,
      },
    })

    await tx.aIScribeSession.update({
      where: { id: sessionId, clinicId },
      data: {
        status: AIScribeStatus.APPROVED,
        patientSummary: patientSummary as object,
        patientSummaryPublished: false,
      },
    })

    // B5.3: the cart is built in the same transaction as the approval, and only
    // from products the provider explicitly confirmed. No confirmation → no cart.
    if (!rx) return null
    const counts = await rxCartService.confirmProposal(
      tx,
      rx.proposalId,
      providerId,
      clinicId,
      performedById,
      rx
    )
    const built = await rxCartService.buildCartFromProposal(tx, rx.proposalId, clinicId)
    return { counts, built }
  })

  const updated = await prisma.aIScribeSession.findUnique({
    where: { id: sessionId, clinicId },
    include: {
      visitRecord: {
        select: {
          id: true,
          isFinalized: true,
          currentVersion: true,
        },
      },
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'VisitRecord',
    entityId: session.visitRecordId,
    action: 'VISIT_FINALIZED',
    fieldChanged: 'isFinalized',
    oldValue: false,
    newValue: true,
    performedById,
  })

  if (rx && rxResult) {
    await rxCartService.auditConfirmAndBuild(
      { id: rx.proposalId, clinicId },
      performedById,
      rxResult.counts,
      rxResult.built,
      { ipAddress: options.ipAddress, userAgent: options.userAgent }
    )
  }

  return updated && { ...updated, rxCart: rxResult?.built ?? null }
}

export const setPatientSummary = async (sessionId: string, patientSummary: PatientSummary) => {
  return prisma.aIScribeSession.update({
    where: { id: sessionId, ...clinicScope() },
    data: { patientSummary: patientSummary as object },
  })
}

export const getApprovedPatientSummary = async (visitRecordId: string, patientId: string) => {
  const session = await prisma.aIScribeSession.findFirst({
    where: {
      visitRecordId,
      status: AIScribeStatus.APPROVED,
      visitRecord: { patientId },
      ...clinicScope(),
    },
    orderBy: { updatedAt: 'desc' },
  })
  return session?.patientSummary as PatientSummary | null
}

/** Patient sees summary only when explicitly published. */
export const getPublishedPatientSummary = async (visitRecordId: string, patientId: string) => {
  const session = await prisma.aIScribeSession.findFirst({
    where: {
      visitRecordId,
      status: AIScribeStatus.APPROVED,
      patientSummaryPublished: true,
      visitRecord: { patientId },
      ...clinicScope(),
    },
    orderBy: { updatedAt: 'desc' },
  })
  return session?.patientSummary as PatientSummary | null
}

export const publishPatientSummary = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) {
    const err = new Error('Session not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (session.status !== AIScribeStatus.APPROVED) {
    const err = new Error('Note must be approved before publishing summary to patient') as ApiError
    err.statusCode = 400
    throw err
  }
  if (!session.patientSummary) {
    const err = new Error('No patient summary to publish') as ApiError
    err.statusCode = 400
    throw err
  }
  await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: { patientSummaryPublished: true },
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'AIScribeSession',
    entityId: sessionId,
    action: 'PATIENT_SUMMARY_PUBLISHED',
    performedById,
  })
  return prisma.aIScribeSession.findUnique({
    where: { id: sessionId, clinicId },
    include: { visitRecord: { select: { id: true } } },
  })
}

export const getSessionByVisitRecordId = async (
  visitRecordId: string,
  providerId: string,
  clinicId: string
) => {
  return prisma.aIScribeSession.findFirst({
    where: {
      visitRecordId,
      providerId,
      clinicId,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      visitRecord: {
        select: {
          id: true,
          appointmentId: true,
          patientId: true,
          isFinalized: true,
          currentVersion: true,
        },
      },
    },
  })
}

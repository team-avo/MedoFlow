/**
 * AI Scribe service - session management, consent, audio upload, draft
 * review and the approval flow (Component 2).
 *
 * Human in the loop (B2.3): the AI only ever writes to the session's draft
 * fields. Nothing reaches the visit record (VisitRecord / VisitNoteVersion)
 * or the patient until the provider approves — and approval itself makes no
 * AI call: it records exactly what the provider reviewed.
 */

import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { AIScribeStatus, ConsentStatus, Prisma } from '@prisma/client'
import * as visitService from './visitService'
import * as storageService from './storageService'
import * as auditService from './auditService'
import * as rxCartService from './rxCartService'
import { getLongitudinalRecord } from './longitudinalService'
import { isScribeDemoEnabled } from './ai/config'
import type { ScribeOrder } from './rxMappingService'
import type { PatientSummary, SoapDraft } from './scribeAnalysis'

export type { PatientSummary, SoapDraft } from './scribeAnalysis'

const fail = (message: string, statusCode: number, code?: string): never => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  if (code) err.code = code
  throw err
}

const sessionInclude = {
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
} as const

// ---------------------------------------------------------------------------
// Consent (FR-1)
// ---------------------------------------------------------------------------

export type ConsentSource = 'BOOKING' | 'PATIENT_CONSULTATION' | 'PROVIDER_ATTESTED_VERBAL'

export interface ConsentState {
  status: 'GRANTED' | 'DECLINED' | 'PENDING'
  source: ConsentSource | null
}

/**
 * Whether this visit may be recorded and sent to the AI. A patient's explicit
 * decline (consultation page) always wins; otherwise consent comes from the
 * booking checkbox, the patient on the consultation page, or the provider's
 * attestation of verbal consent for an in-person visit.
 */
export async function getConsentState(
  session: { id: string; clinicId: string; consentSource: string | null },
  appointmentId: string
): Promise<ConsentState> {
  const [appointment, consultation] = await Promise.all([
    prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: session.clinicId },
      select: { aiScribeConsentGrantedAt: true },
    }),
    prisma.consultationSession.findFirst({
      where: { appointmentId, clinicId: session.clinicId },
      orderBy: { createdAt: 'desc' },
      select: { consentStatus: true },
    }),
  ])
  if (consultation?.consentStatus === ConsentStatus.DECLINED) {
    return { status: 'DECLINED', source: null }
  }
  if (consultation?.consentStatus === ConsentStatus.GRANTED) {
    return { status: 'GRANTED', source: 'PATIENT_CONSULTATION' }
  }
  if (appointment?.aiScribeConsentGrantedAt) return { status: 'GRANTED', source: 'BOOKING' }
  if (session.consentSource === 'PROVIDER_ATTESTED_VERBAL') {
    return { status: 'GRANTED', source: 'PROVIDER_ATTESTED_VERBAL' }
  }
  return { status: 'PENDING', source: null }
}

/** The provider attests that the patient gave verbal consent (in-person visits). */
export const attestVerbalConsent = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  performedById: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) => {
  const session = await requireSession(sessionId, providerId, clinicId)
  const consent = await getConsentState(session, session.visitRecord.appointmentId)
  if (consent.status === 'DECLINED') {
    fail('The patient declined AI recording for this visit', 409, 'consent_declined')
  }
  if (consent.status === 'GRANTED') return { session, consent }

  const updated = await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: { consentSource: 'PROVIDER_ATTESTED_VERBAL', consentRecordedAt: new Date() },
    include: sessionInclude,
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'AIScribeSession',
    entityId: sessionId,
    action: 'CONSENT_ATTESTED',
    newValue: { source: 'PROVIDER_ATTESTED_VERBAL' },
    performedById,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return {
    session: updated,
    consent: { status: 'GRANTED', source: 'PROVIDER_ATTESTED_VERBAL' } as ConsentState,
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const createSession = async (
  visitRecordId: string,
  providerId: string,
  clinicId: string,
  performedById: string | null = null
) => {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { aiEnabled: true },
  })
  if (clinic?.aiEnabled === false) {
    fail('AI Scribe is not enabled for this clinic', 403, 'ai_disabled')
  }
  const visitRecord = await visitService.getVisitRecordById(visitRecordId, { clinicId })
  if (!visitRecord) fail('Visit record not found', 404)
  if (visitRecord!.providerId !== providerId) fail('Access denied', 403)
  if ((visitRecord as { isFinalized?: boolean }).isFinalized) {
    fail('Visit record is finalized', 400, 'visit_finalized')
  }

  // One open scribe session per visit: reopening the console resumes it.
  const open = await prisma.aIScribeSession.findFirst({
    where: { visitRecordId, providerId, clinicId, status: { not: AIScribeStatus.APPROVED } },
    orderBy: { createdAt: 'desc' },
    include: { visitRecord: { select: { id: true, appointmentId: true } } },
  })
  if (open) return open

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
  await auditService.logAudit({
    clinicId,
    entityType: 'AIScribeSession',
    entityId: session.id,
    action: 'AI_SCRIBE_SESSION_CREATED',
    newValue: { visitRecordId },
    performedById,
  })
  return session
}

/** The demo conversation (POST /simulate). Synthetic: no real person. */
export const DEMO_TRANSCRIPT = `
Provider: How have you been feeling since your last session?
Patient: I'm doing better, but my lower back is still quite stiff in the mornings.
Provider: Does the stiffness go away after you start moving, or does it persist throughout the day?
Patient: It usually gets better after about 30 minutes of walking around, but if I sit for too long at work, it comes back.
Provider: Let's take a look at your range of motion today. Please lean forward... there's some restriction in the lumbar region.
Patient: Yeah, right there is where it feels tight.
Provider: We'll continue with the manual therapy we started last week, and add some core stabilization exercises to your home program.
Patient: That sounds good. I've been doing the stretches you gave me.
Provider: Great. Let's aim for 3 sets of 10 repetitions for the new exercises, twice a day. I'll see you again in 4 days.
Provider: For the muscle tension, take magnesium glycinate 400 mg at night, two bottles should last until next month, and use arnica gel on the sore area. I'm also writing tramadol 50 mg for the bad nights, and try a turmeric complex.
`.trim()

export const simulateSession = async (sessionId: string, providerId: string, clinicId: string) => {
  if (!isScribeDemoEnabled()) fail('Not found', 404, 'not_found')
  const session = await requireSession(sessionId, providerId, clinicId)
  if (session.status === AIScribeStatus.APPROVED) {
    fail('This session has already been finalized.', 400, 'invalid_state')
  }

  // Orders the scribe would extract from this conversation (B5.1, B2.2).
  const demoOrders: ScribeOrder[] = [
    { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
    { name: 'Arnica gel', dose: null, quantity: 1 },
    { name: 'Tramadol', dose: '50 mg', quantity: 1 },
    { name: 'Turmeric complex', dose: null, quantity: 1 },
  ]

  const demoSoap: SoapDraft = {
    subjective:
      'Patient reports morning stiffness in the lower back that improves after 30 minutes of activity but recurs with prolonged sitting. Patient has been compliant with previously prescribed stretches.',
    objective:
      'Physical exam reveals restricted lumbar range of motion during forward flexion. Palpation identifies tightness in the paraspinal muscles.',
    assessment:
      'Progressing well with rehab for lumbar strain. Stiffness indicates a need for increased core stability to support spinal alignment during sedentary work.',
    plan: '1. Manual therapy (myofascial release) to lumbar region. 2. Added core stabilization exercises (Dead Bug and Bird-Dog) to HEP: 3x10, twice daily. 3. Follow-up appointment in 4 days.',
  }

  const demoSummary: PatientSummary = {
    diagnosis:
      'Your lower back strain is healing well. The morning stiffness is expected at this stage.',
    treatmentPlan:
      'We continued hands-on therapy and added two core exercises: 3 sets of 10, twice a day. Magnesium at night and arnica gel can help with muscle tension.',
    nextSteps: 'Keep doing your exercises and stretches, and come back in 4 days.',
  }

  // Products first: the review screen loads them as soon as the draft is ready.
  await rxCartService.upsertProposalForSession(sessionId, clinicId, demoOrders)

  const updated = await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: {
      status: AIScribeStatus.DRAFT_GENERATED,
      transcript: DEMO_TRANSCRIPT,
      aiDraft: demoSoap as object,
      timeline: {
        symptoms: ['lower back stiffness', 'tightness with prolonged sitting'],
        duration: 'ongoing, improving',
        assessment: 'Lumbar strain, progressing',
        plan: ['Manual therapy', 'Core stabilization 3x10 twice daily', 'Follow-up in 4 days'],
        continuity: 'Since the last session: stiffness improving with the home stretches.',
      } as object,
      patientSummary: demoSummary as object,
      patientSummaryPublished: false,
      aiModel: 'demo-simulation',
      aiProvider: 'demo',
      sttModel: null,
      errorMessage: null,
      processingStartedAt: new Date(),
      processingCompletedAt: new Date(),
    },
  })

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
  const session = await requireSession(sessionId, providerId, clinicId)
  if (session.status !== AIScribeStatus.RECORDING && session.status !== AIScribeStatus.FAILED) {
    fail('Session is not in recording state', 400, 'invalid_state')
  }
  // FR-1: no audio is stored or sent to the AI without consent.
  const consent = await getConsentState(session, session.visitRecord.appointmentId)
  if (consent.status === 'DECLINED') {
    fail('The patient declined AI recording for this visit', 403, 'consent_declined')
  }
  if (consent.status !== 'GRANTED') {
    fail('Patient consent is required before recording', 403, 'consent_required')
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
      consentSource: consent.source,
      consentRecordedAt: session.consentRecordedAt ?? new Date(),
      // New audio: everything derived from the previous recording is stale.
      transcript: null,
      timeline: Prisma.DbNull,
      aiDraft: Prisma.DbNull,
      patientSummary: Prisma.DbNull,
      sttModel: null,
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
    include: sessionInclude,
  })
}

export const getSessionForProvider = getSessionById

async function requireSession(sessionId: string, providerId: string, clinicId: string) {
  const session = await getSessionById(sessionId, providerId, clinicId)
  if (!session) fail('Session not found', 404)
  return session!
}

// ---------------------------------------------------------------------------
// Review (FR-8)
// ---------------------------------------------------------------------------

const EDITABLE: readonly AIScribeStatus[] = [AIScribeStatus.DRAFT_GENERATED, AIScribeStatus.EDITED]

const mergeSoap = (
  current: Partial<SoapDraft> | null,
  edit: Partial<SoapDraft> = {}
): SoapDraft => ({
  subjective: edit.subjective ?? current?.subjective ?? '',
  objective: edit.objective ?? current?.objective ?? '',
  assessment: edit.assessment ?? current?.assessment ?? '',
  plan: edit.plan ?? current?.plan ?? '',
})

const mergeSummary = (
  current: Partial<PatientSummary> | null,
  edit: Partial<PatientSummary> = {}
): PatientSummary => ({
  diagnosis: edit.diagnosis ?? current?.diagnosis ?? '',
  treatmentPlan: edit.treatmentPlan ?? current?.treatmentPlan ?? '',
  nextSteps: edit.nextSteps ?? current?.nextSteps ?? '',
})

const hasContent = (o: object) => Object.values(o).some((v) => typeof v === 'string' && v.trim())

export interface DraftEdit extends Partial<SoapDraft> {
  patientSummary?: Partial<PatientSummary>
}

export const updateDraft = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  edit: DraftEdit,
  performedById: string | null = null
) => {
  const session = await requireSession(sessionId, providerId, clinicId)
  if (!EDITABLE.includes(session.status)) {
    fail('Draft not available for editing', 400, 'invalid_state')
  }
  const { patientSummary, ...soapEdit } = edit
  const merged = mergeSoap(session.aiDraft as Partial<SoapDraft> | null, soapEdit)
  const summary = mergeSummary(
    session.patientSummary as Partial<PatientSummary> | null,
    patientSummary
  )

  const updated = await prisma.aIScribeSession.update({
    where: { id: sessionId, clinicId },
    data: {
      aiDraft: merged as object,
      patientSummary: summary as object,
      status: AIScribeStatus.EDITED,
    },
  })
  const fields = [
    ...Object.keys(soapEdit),
    ...Object.keys(patientSummary ?? {}).map((k) => `patientSummary.${k}`),
  ]
  await auditService.logAudit({
    clinicId,
    entityType: 'AIScribeSession',
    entityId: sessionId,
    action: 'AI_DRAFT_EDITED',
    // Which fields changed — never their content.
    newValue: { fields },
    performedById,
  })
  return updated
}

export interface ApproveOptions {
  /** "Approve & send": the provider's explicit confirmation of the detected products (B5.2). */
  rxConfirmation?: { proposalId: string } & rxCartService.RxConfirmation
  /** Publish the reviewed patient summary in the same transaction (B2.4). Default false. */
  sendToPatient?: boolean
  /** The final text as the provider left it on screen (saved with the approval). */
  draft?: Partial<SoapDraft>
  patientSummary?: Partial<PatientSummary>
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
  const session = await requireSession(sessionId, providerId, clinicId)
  if (!EDITABLE.includes(session.status)) {
    fail('Draft must be ready before approval', 400, 'invalid_state')
  }
  if (session.visitRecord.isFinalized) {
    fail('This visit already has a finalized note', 409, 'visit_finalized')
  }

  const draft = mergeSoap(session.aiDraft as Partial<SoapDraft> | null, options.draft)
  if (!hasContent(draft)) fail('No draft content to approve', 400, 'draft_empty')
  const summary = mergeSummary(
    session.patientSummary as Partial<PatientSummary> | null,
    options.patientSummary
  )
  const send = options.sendToPatient === true
  if (send && !hasContent(summary)) {
    fail('Write the patient summary before sending it', 400, 'summary_required')
  }

  const provider = await visitService.getProviderByUserId(performedById)
  if (!provider || session.providerId !== provider.id) {
    fail('Provider not found or access denied', 403)
  }

  const formattedNote = [
    'Subjective:',
    draft.subjective,
    '',
    'Objective:',
    draft.objective,
    '',
    'Assessment:',
    draft.assessment,
    '',
    'Plan:',
    draft.plan,
  ].join('\n')

  const rx = options.rxConfirmation
  if (rx) {
    const proposal = await rxCartService.getProposalForSession(sessionId, providerId, clinicId)
    if (!proposal || proposal.id !== rx.proposalId) {
      fail('Proposal not found for this session', 404)
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
        aiDraft: draft as object,
        patientSummary: summary as object,
        patientSummaryPublished: send,
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

  const meta = { ipAddress: options.ipAddress ?? null, userAgent: options.userAgent ?? null }
  await auditService.logAudit({
    clinicId,
    entityType: 'VisitRecord',
    entityId: session.visitRecordId,
    action: 'VISIT_FINALIZED',
    fieldChanged: 'isFinalized',
    oldValue: false,
    newValue: true,
    performedById,
    ...meta,
  })
  if (send) {
    await auditService.logAudit({
      clinicId,
      entityType: 'AIScribeSession',
      entityId: sessionId,
      action: 'PATIENT_SUMMARY_PUBLISHED',
      performedById,
      ...meta,
    })
  }

  if (rx && rxResult) {
    await rxCartService.auditConfirmAndBuild(
      { id: rx.proposalId, clinicId },
      performedById,
      rxResult.counts,
      rxResult.built,
      meta
    )
  }

  return updated && { ...updated, rxCart: rxResult?.built ?? null }
}

// ---------------------------------------------------------------------------
// Patient-facing summary (FR-10)
// ---------------------------------------------------------------------------

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

export interface PublishedSummaryItem {
  sessionId: string
  clinicId: string
  visitRecordId: string
  appointmentId: string
  visitDate: Date
  providerName: string | null
  publishedAt: Date
  summary: PatientSummary
}

/**
 * The patient's portal list (F2.6): published summaries only, nothing else
 * from the visit — no note, no transcript, no draft (B2.4).
 */
export const listPublishedSummariesForPatient = async (
  patientId: string
): Promise<PublishedSummaryItem[]> => {
  const sessions = await prisma.aIScribeSession.findMany({
    where: {
      status: AIScribeStatus.APPROVED,
      patientSummaryPublished: true,
      visitRecord: { patientId },
      ...clinicScope(),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      clinicId: true,
      updatedAt: true,
      patientSummary: true,
      visitRecord: {
        select: {
          id: true,
          appointmentId: true,
          appointment: { select: { startTime: true } },
          provider: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  return sessions
    .filter((s) => s.patientSummary && hasContent(s.patientSummary as object))
    .map((s) => {
      const p = s.visitRecord.provider
      const providerName = [p?.firstName, p?.lastName].filter(Boolean).join(' ') || null
      return {
        sessionId: s.id,
        clinicId: s.clinicId,
        visitRecordId: s.visitRecord.id,
        appointmentId: s.visitRecord.appointmentId,
        visitDate: s.visitRecord.appointment.startTime,
        providerName,
        publishedAt: s.updatedAt,
        summary: mergeSummary(s.patientSummary as Partial<PatientSummary>),
      }
    })
}

export const publishPatientSummary = async (
  sessionId: string,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const session = await requireSession(sessionId, providerId, clinicId)
  if (session.status !== AIScribeStatus.APPROVED) {
    fail('Note must be approved before publishing summary to patient', 400, 'invalid_state')
  }
  if (!session.patientSummary || !hasContent(session.patientSummary as object)) {
    fail('No patient summary to publish', 400, 'summary_required')
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
    include: sessionInclude,
  })
}

// ---------------------------------------------------------------------------
// Longitudinal record (FR-7)
// ---------------------------------------------------------------------------

export const getLongitudinalForSession = async (
  sessionId: string,
  providerId: string,
  clinicId: string
) => {
  const session = await requireSession(sessionId, providerId, clinicId)
  return getLongitudinalRecord(session.visitRecord.patientId, clinicId, session.visitRecordId)
}

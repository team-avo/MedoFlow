/**
 * Component 2 — AI Scribe / EMR over HTTP against Postgres (enforce + RLS),
 * with the deterministic in-process AI (AI_SCRIBE_*_PROVIDER=mock).
 *
 *  FR-1  consent before recording (booking / patient / provider-attested; decline blocks)
 *  FR-3…7 transcribe → label → validated draft with dose, continuity, patient summary
 *  B2.3  nothing reaches the record before the provider approves
 *  B2.4  "Approve & send": one transaction; patients see only the published summary
 *  B2.5  note versions are immutable (DB trigger)
 *  B2.6  job data is ids only; failures never put PHI in logs, errors or the queue
 *  FR-11 retries do not show FAILED early; a final failure shows a safe reason; 503s
 *  FR-15 provenance + audit rows · FR-16 demo guard, validation, tenant isolation
 *  B2.8  longitudinal: prior approved visits feed the draft and the review panel
 *
 * The queue is replaced in-process (no Redis); jobs run by calling the worker
 * function directly. Nothing leaves the machine.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Prisma } from '@prisma/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import * as rxCartService from '../../services/rxCartService'
import {
  runScribeJob,
  setAiScribeQueueForTests,
  type AiScribeJobData,
} from '../../queues/aiScribeQueue'
import { withTenantBypass } from '../../config/tenantContext'
import {
  MOCK_MODEL,
  MOCK_TRANSCRIPT,
  mockScribeControl,
  PRIOR_VISITS_MARKER,
} from '../../services/ai/mock'
import { resetScribeAi } from '../../services/ai/registry'
import { buildPriorDigest } from '../../services/longitudinalService'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let aProvider = ''
let aPatient = ''
let bProvider = ''

/** Jobs the app enqueued (B2.6: the payload must be ids only). */
const queued: Array<{ name: string; data: AiScribeJobData }> = []
let queueDown = false
const sessionsCreated: string[] = []

let hours = 0
/**
 * A fresh appointment + open visit record for patient A. Each one is later
 * than the last (all in the past, never overlapping — B1.1), like real visits.
 */
async function newVisit(opts: { bookingConsent?: boolean } = {}) {
  hours += 1
  const start = new Date(Date.now() - (30 * 24 - hours * 2) * 3_600_000)
  start.setUTCMinutes(0, 0, 0)
  const appt = await adminDb.appointment.create({
    data: {
      clinicId: A.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: A.users.patient.id,
      locationId: A.locationId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      priceAtBooking: new Prisma.Decimal(100),
      status: 'COMPLETED',
      aiScribeConsentGrantedAt: opts.bookingConsent ? new Date() : null,
    },
  })
  const visit = await adminDb.visitRecord.create({
    data: {
      clinicId: A.clinicId,
      appointmentId: appt.id,
      providerId: A.providerId,
      patientId: A.users.patient.id,
    },
  })
  return { appointmentId: appt.id, visitRecordId: visit.id }
}

async function start(visitRecordId: string, token = aProvider) {
  const res = await api(server.url, '/ai-scribe/session/start', { token, body: { visitRecordId } })
  expect(res.status).toBe(201)
  sessionsCreated.push(res.body.data.session.id)
  return res.body.data.session as { id: string; consent: { status: string; source: string | null } }
}

async function upload(
  sessionId: string,
  token = aProvider,
  type = 'audio/webm',
  name = 'visit.webm'
) {
  const form = new FormData()
  form.append('audio', new Blob([crypto.randomBytes(2048)], { type }), name)
  const res = await fetch(`${server.url}/ai-scribe/session/${sessionId}/audio`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-medoflow-client': 'web' },
    body: form,
  })
  return { status: res.status, body: (await res.json()) as any }
}

const attest = (sessionId: string, token = aProvider) =>
  api(server.url, `/ai-scribe/session/${sessionId}/consent`, {
    token,
    body: { method: 'VERBAL', acknowledged: true },
  })

/** Runs one worker attempt for a session, as BullMQ would. */
function runJob(sessionId: string, attemptsMade = 0, extra: Partial<AiScribeJobData> = {}) {
  return withTenantBypass('ai-scribe-worker', () =>
    runScribeJob({
      data: { sessionId, clinicId: A.clinicId, ...extra },
      attemptsMade,
      opts: { attempts: 3 },
      updateProgress: () => Promise.resolve(),
    })
  )
}

const getSession = async (sessionId: string, token = aProvider) =>
  (await api(server.url, `/ai-scribe/session/${sessionId}`, { token })).body.data.session

const auditActions = async (entityId: string) =>
  (await adminDb.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
    (r) => r.action
  )

/** A recorded, drafted session (consent attested by the provider). */
async function draftedSession() {
  const visit = await newVisit()
  const session = await start(visit.visitRecordId)
  expect((await attest(session.id)).status).toBe(200)
  expect((await upload(session.id)).status).toBe(200)
  await runJob(session.id)
  return { ...visit, sessionId: session.id }
}

beforeAll(async () => {
  setAiScribeQueueForTests({
    add: ((name: string, data: AiScribeJobData) => {
      if (queueDown) return Promise.reject(new Error('connect ECONNREFUSED'))
      queued.push({ name, data })
      return Promise.resolve({ id: `job-${queued.length}` })
    }) as never,
  })
  server = await startServer()
  A = await createClinicFixture('scribe-a')
  B = await createClinicFixture('scribe-b')
  aProvider = (await login(server.url, A.users.provider.email)).accessToken
  aPatient = (await login(server.url, A.users.patient.email)).accessToken
  bProvider = (await login(server.url, B.users.provider.email)).accessToken
})

afterEach(() => {
  mockScribeControl.reset()
  queueDown = false
})

afterAll(async () => {
  setAiScribeQueueForTests(null)
  await server?.close()
  // Synthetic audio written by the local storage driver.
  for (const id of sessionsCreated) {
    fs.rmSync(path.join(process.cwd(), 'uploads', 'ai-scribe', id), {
      recursive: true,
      force: true,
    })
  }
})

describe('capabilities', () => {
  it('reports what the UI may offer, with no hosts, URLs or keys', async () => {
    const res = await api(server.url, '/ai-scribe/capabilities', { token: aProvider })
    expect(res.status).toBe(200)
    const caps = res.body.data.capabilities
    expect(caps).toMatchObject({ available: true, demoEnabled: true })
    expect(caps.llm).toEqual({
      kind: 'mock',
      preset: 'mock',
      model: MOCK_MODEL,
      location: 'in-process',
    })
    expect(JSON.stringify(caps)).not.toMatch(/http|host|key/i)
  })

  it('is provider-only', async () => {
    expect((await api(server.url, '/ai-scribe/capabilities', { token: aPatient })).status).toBe(403)
  })
})

describe('FR-1 consent before recording', () => {
  it('no consent: the session opens, but audio is refused and nothing is queued', async () => {
    const visit = await newVisit()
    const session = await start(visit.visitRecordId)
    expect(session.consent).toEqual({ status: 'PENDING', source: null })
    const res = await upload(session.id)
    expect(res.status).toBe(403)
    expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toMatch(
      /consent_required/
    )
    expect(queued.filter((j) => j.data.sessionId === session.id)).toHaveLength(0)
    expect(
      (await adminDb.aIScribeSession.findUnique({ where: { id: session.id } }))!.audioUrl
    ).toBeNull()
  })

  it('booking-time consent counts', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    expect(session.consent).toEqual({ status: 'GRANTED', source: 'BOOKING' })
    expect((await upload(session.id)).status).toBe(200)
    expect(
      (await adminDb.aIScribeSession.findUnique({ where: { id: session.id } }))!.consentSource
    ).toBe('BOOKING')
  })

  it('the provider can attest verbal consent (audited) — but never over a patient decline', async () => {
    const visit = await newVisit()
    const session = await start(visit.visitRecordId)
    const ok = await attest(session.id)
    expect(ok.status).toBe(200)
    expect(ok.body.data.session.consent).toEqual({
      status: 'GRANTED',
      source: 'PROVIDER_ATTESTED_VERBAL',
    })
    expect(await auditActions(session.id)).toContain('CONSENT_ATTESTED')

    const declinedVisit = await newVisit()
    const consultation = await adminDb.consultationSession.create({
      data: {
        clinicId: A.clinicId,
        appointmentId: declinedVisit.appointmentId,
        providerId: A.providerId,
        patientId: A.users.patient.id,
        status: 'READY',
        joinToken: crypto.randomBytes(16).toString('hex'),
        joinTokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    const decline = await api(server.url, `/consultations/${consultation.id}/consent/decline`, {
      token: aPatient,
      method: 'POST',
    })
    expect(decline.status).toBe(200)
    expect(decline.body.data.session.consentStatus).toBe('DECLINED')
    expect(await auditActions(consultation.id)).toContain('CONSENT_DECLINED')

    const s2 = await start(declinedVisit.visitRecordId)
    expect(s2.consent.status).toBe('DECLINED')
    expect((await attest(s2.id)).status).toBe(409)
    expect((await upload(s2.id)).status).toBe(403)
    // The consultation recording path refuses too.
    const rec = await api(server.url, `/consultations/${consultation.id}/recording/start`, {
      token: aProvider,
      method: 'POST',
    })
    expect(rec.status).toBe(400)
  })

  it('only the patient can decline, and attestation must be explicit', async () => {
    const visit = await newVisit()
    const consultation = await adminDb.consultationSession.create({
      data: {
        clinicId: A.clinicId,
        appointmentId: visit.appointmentId,
        providerId: A.providerId,
        patientId: A.users.patient.id,
        status: 'READY',
        joinToken: crypto.randomBytes(16).toString('hex'),
        joinTokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    const byProvider = await api(server.url, `/consultations/${consultation.id}/consent/decline`, {
      token: aProvider,
      method: 'POST',
    })
    expect(byProvider.status).toBe(403)
    const session = await start(visit.visitRecordId)
    const bad = await api(server.url, `/ai-scribe/session/${session.id}/consent`, {
      token: aProvider,
      body: { method: 'VERBAL', acknowledged: false },
    })
    expect(bad.status).toBe(400)
  })
})

describe('the pipeline (FR-3 … FR-7) and human in the loop (B2.3)', () => {
  it('upload → job → validated draft with provenance; nothing reaches the record yet', async () => {
    const visit = await newVisit()
    const session = await start(visit.visitRecordId)
    await attest(session.id)
    const up = await upload(session.id)
    expect(up.status).toBe(200)
    expect(up.body.data.session.status).toBe('TRANSCRIBING')

    // B2.6: the job carries ids only.
    const job = queued.find((j) => j.data.sessionId === session.id)!
    expect(job.name).toBe('process')
    expect(Object.keys(job.data).sort()).toEqual(['clinicId', 'regenerateSoapOnly', 'sessionId'])
    expect(job.data.clinicId).toBe(A.clinicId)

    await runJob(session.id)

    const s = await getSession(session.id)
    expect(s.status).toBe('DRAFT_GENERATED')
    expect(s.transcript).toBe(MOCK_TRANSCRIPT)
    expect(s.aiDraft.assessment).toMatch(/Fatigue, improving/)
    expect(s.patientSummary.nextSteps).toMatch(/six weeks/)
    expect(s.patientSummaryPublished).toBe(false)
    expect(s.timeline.symptoms).toContain('fatigue')
    expect(s).toMatchObject({ aiModel: MOCK_MODEL, aiProvider: 'mock:mock', sttModel: MOCK_MODEL })
    expect(s.errorMessage).toBeNull()

    // B2.2: dose is a separate field on the detected products.
    const proposal = (
      await api(server.url, `/rx-cart/sessions/${session.id}/proposal`, { token: aProvider })
    ).body.data.proposal
    expect(proposal.lines.map((l: any) => [l.rawText, l.dose, l.quantity])).toEqual([
      ['Vitamin D3', '5000 IU', 1],
      ['Magnesium glycinate', '400 mg', 2],
    ])

    // B2.3: the visit record is untouched until approval.
    const record = await adminDb.visitRecord.findUnique({ where: { id: visit.visitRecordId } })
    expect(record).toMatchObject({ isFinalized: false, subjective: null, currentVersionId: null })
    expect(
      await adminDb.visitNoteVersion.count({ where: { visitRecordId: visit.visitRecordId } })
    ).toBe(0)

    // B3.2: transcript, draft and dose are sealed at rest.
    const [raw] = await adminDb.$queryRaw<Array<{ transcript: string; aiDraft: unknown }>>`
      SELECT "transcript", "aiDraft" FROM "AIScribeSession" WHERE id = ${session.id}`
    expect(raw!.transcript.startsWith('fle:v1:')).toBe(true)
    expect(JSON.stringify(raw!.aiDraft)).toMatch(/^"fle:v1:/)
    const doses = await adminDb.$queryRaw<Array<{ dose: string }>>`
      SELECT l."dose" FROM "RxOrderLine" l JOIN "RxOrderProposal" p ON p.id = l."proposalId"
      WHERE p."aiScribeSessionId" = ${session.id}`
    expect(doses.every((d) => d.dose.startsWith('fle:v1:'))).toBe(true)

    // FR-15: audited with provenance, never content.
    const rows = await adminDb.auditLog.findMany({ where: { entityId: session.id } })
    const actions = rows.map((r) => r.action)
    expect(actions).toEqual(
      expect.arrayContaining(['AI_SCRIBE_SESSION_CREATED', 'AI_DRAFT_GENERATED'])
    )
    const generated = rows.find((r) => r.action === 'AI_DRAFT_GENERATED')!
    expect(generated.newValue).toEqual({
      aiProvider: 'mock:mock',
      aiModel: MOCK_MODEL,
      sttModel: MOCK_MODEL,
    })
    expect(JSON.stringify(rows)).not.toMatch(/fatigue|Vitamin/i)

    // The patient sees nothing of it.
    const patientView = await api(server.url, `/visits/appointment/${visit.appointmentId}`, {
      token: aPatient,
    })
    expect(JSON.stringify(patientView.body)).not.toMatch(/fatigue|Vitamin D3|Provider:/i)
  })

  it('a duplicate or late job for an approved session is a no-op', async () => {
    const { sessionId } = await draftedSession()
    const ok = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      body: {},
    })
    expect(ok.status).toBe(200)
    mockScribeControl.reset()
    await runJob(sessionId)
    expect(mockScribeControl.calls).toHaveLength(0)
    expect((await getSession(sessionId)).status).toBe('APPROVED')
  })

  it('a regenerated draft is marked ready only once its detected products are current', async () => {
    // The review screen loads the products as soon as it sees DRAFT_GENERATED;
    // with the old order it read the previous lines and "Approve & send" then
    // failed with "Line not found".
    const { sessionId } = await draftedSession()
    const proposalUrl = `/rx-cart/sessions/${sessionId}/proposal`
    const before = (await api(server.url, proposalUrl, { token: aProvider })).body.data.proposal
    const regen = await api(server.url, `/ai-scribe/session/${sessionId}/regenerate`, {
      token: aProvider,
      body: {},
    })
    expect(regen.status).toBe(200)

    const statusAtUpsert: string[] = []
    const original = rxCartService.upsertProposalForSession
    const spy = vi
      .spyOn(rxCartService, 'upsertProposalForSession')
      .mockImplementation(async (...args) => {
        const row = await adminDb.aIScribeSession.findUnique({ where: { id: sessionId } })
        statusAtUpsert.push(row!.status)
        return original(...args)
      })
    try {
      await runJob(sessionId, 0, { regenerateSoapOnly: true })
    } finally {
      spy.mockRestore()
    }
    expect(statusAtUpsert).toEqual(['TRANSCRIBING'])

    const after = (await api(server.url, proposalUrl, { token: aProvider })).body.data.proposal
    expect((await getSession(sessionId)).status).toBe('DRAFT_GENERATED')
    expect(after.lines).toHaveLength(2)
    const oldIds = new Set(before.lines.map((l: any) => l.id))
    expect(after.lines.some((l: any) => oldIds.has(l.id))).toBe(false)
  })

  it('a .webm recording picked from disk (typed video/webm by the browser) is accepted as audio', async () => {
    const visit = await newVisit()
    const session = await start(visit.visitRecordId)
    await attest(session.id)
    // Other video types are still refused.
    expect((await upload(session.id, aProvider, 'video/mp4', 'clip.mp4')).status).toBe(400)
    const res = await upload(session.id, aProvider, 'video/webm', 'consultation.webm')
    expect(res.status).toBe(200)
    expect(res.body.data.session.status).toBe('TRANSCRIBING')
  })

  it('reopening the console resumes the open session instead of creating another', async () => {
    const visit = await newVisit()
    const first = await start(visit.visitRecordId)
    const again = await start(visit.visitRecordId)
    expect(again.id).toBe(first.id)
  })
})

describe('review: edit and validation (FR-8, FR-16)', () => {
  it('edits the note and the patient summary; the audit names the fields, not the text', async () => {
    const { sessionId } = await draftedSession()
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/draft`, {
      token: aProvider,
      method: 'PUT',
      body: { assessment: 'EDITED-ASSESSMENT', patientSummary: { nextSteps: 'EDITED-NEXT' } },
    })
    expect(res.status).toBe(200)
    const s = await getSession(sessionId)
    expect(s.status).toBe('EDITED')
    expect(s.aiDraft.assessment).toBe('EDITED-ASSESSMENT')
    expect(s.aiDraft.plan).toMatch(/Recheck/)
    expect(s.patientSummary.nextSteps).toBe('EDITED-NEXT')
    const row = (
      await adminDb.auditLog.findMany({ where: { entityId: sessionId, action: 'AI_DRAFT_EDITED' } })
    )[0]!
    expect(row.newValue).toEqual({ fields: ['assessment', 'patientSummary.nextSteps'] })
    expect(JSON.stringify(row)).not.toMatch(/EDITED-/)
  })

  it('rejects oversized and unknown fields', async () => {
    const { sessionId } = await draftedSession()
    const big = await api(server.url, `/ai-scribe/session/${sessionId}/draft`, {
      token: aProvider,
      method: 'PUT',
      body: { subjective: 'x'.repeat(20_001) },
    })
    expect(big.status).toBe(400)
    const unknown = await api(server.url, `/ai-scribe/session/${sessionId}/draft`, {
      token: aProvider,
      method: 'PUT',
      body: { status: 'APPROVED' },
    })
    expect(unknown.status).toBe(400)
    expect((await getSession(sessionId)).status).toBe('DRAFT_GENERATED')
  })
})

describe('B2.4 "Approve & send"', () => {
  it('finalizes the note and publishes only the reviewed summary, in one step', async () => {
    const { sessionId, visitRecordId, appointmentId } = await draftedSession()
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      body: {
        sendToPatient: true,
        draft: { plan: 'INTERNAL-PLAN-MARKER' },
        patientSummary: { diagnosis: 'PATIENT-FACING-MARKER' },
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.data.session).toMatchObject({
      status: 'APPROVED',
      patientSummaryPublished: true,
    })

    const record = await adminDb.visitRecord.findUnique({ where: { id: visitRecordId } })
    expect(record).toMatchObject({ isFinalized: true, status: 'FINAL' })
    expect(await adminDb.visitNoteVersion.count({ where: { visitRecordId } })).toBe(1)
    expect(await auditActions(sessionId)).toContain('PATIENT_SUMMARY_PUBLISHED')
    expect(await auditActions(visitRecordId)).toContain('VISIT_FINALIZED')

    // The patient sees the summary, never the note or the transcript.
    const view = await api(server.url, `/visits/appointment/${appointmentId}`, { token: aPatient })
    expect(view.status).toBe(200)
    expect(view.body.data.patientSummary.diagnosis).toBe('PATIENT-FACING-MARKER')
    const text = JSON.stringify(view.body)
    expect(text).not.toContain('INTERNAL-PLAN-MARKER')
    expect(text).not.toMatch(/Provider:|transcript/i)

    // And in the portal list (F2.6).
    const list = await api(server.url, '/visits/me/summaries', { token: aPatient })
    expect(list.status).toBe(200)
    const item = list.body.data.summaries.find((x: any) => x.sessionId === sessionId)
    expect(item.summary.diagnosis).toBe('PATIENT-FACING-MARKER')
    expect(JSON.stringify(list.body)).not.toContain('INTERNAL-PLAN-MARKER')
  })

  it('approval without sendToPatient keeps the summary private until published', async () => {
    const { sessionId } = await draftedSession()
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      body: {},
    })
    expect(res.body.data.session.patientSummaryPublished).toBe(false)
    const list = await api(server.url, '/visits/me/summaries', { token: aPatient })
    expect(list.body.data.summaries.some((x: any) => x.sessionId === sessionId)).toBe(false)
    const pub = await api(server.url, `/ai-scribe/session/${sessionId}/publish-summary`, {
      token: aProvider,
      method: 'POST',
    })
    expect(pub.status).toBe(200)
  })

  it('sending an empty summary is refused and nothing changes', async () => {
    const { sessionId, visitRecordId } = await draftedSession()
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      body: {
        sendToPatient: true,
        patientSummary: { diagnosis: ' ', treatmentPlan: '', nextSteps: '' },
      },
    })
    expect(res.status).toBe(400)
    expect((await getSession(sessionId)).status).toBe('DRAFT_GENERATED')
    expect(await adminDb.visitNoteVersion.count({ where: { visitRecordId } })).toBe(0)
  })

  it('a visit that already has a finalized note cannot be approved into again (409)', async () => {
    const { sessionId, visitRecordId } = await draftedSession()
    await adminDb.visitRecord.update({ where: { id: visitRecordId }, data: { isFinalized: true } })
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      body: {},
    })
    expect(res.status).toBe(409)
    expect(await adminDb.visitNoteVersion.count({ where: { visitRecordId } })).toBe(0)
    const again = await api(server.url, '/ai-scribe/session/start', {
      token: aProvider,
      body: { visitRecordId },
    })
    expect(again.status).toBe(400)
  })
})

describe('B2.5 immutable versions', () => {
  it('a version cannot be edited, even by the database owner; later visits leave it byte-identical', async () => {
    const { sessionId, visitRecordId } = await draftedSession()
    await api(server.url, `/ai-scribe/session/${sessionId}/approve`, { token: aProvider, body: {} })
    const [before] = await adminDb.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "VisitNoteVersion" WHERE "visitRecordId" = ${visitRecordId}`

    await expect(
      adminDb.$executeRaw`UPDATE "VisitNoteVersion" SET "plan" = 'tampered' WHERE "visitRecordId" = ${visitRecordId}`
    ).rejects.toThrow(/immutable/)
    await expect(
      adminDb.$executeRaw`UPDATE "VisitNoteVersion" SET "createdById" = ${A.users.admin.id} WHERE "visitRecordId" = ${visitRecordId}`
    ).rejects.toThrow(/immutable/)

    await draftedSession() // another visit for the same patient
    const [after] = await adminDb.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "VisitNoteVersion" WHERE "visitRecordId" = ${visitRecordId}`
    expect(after).toEqual(before)
  })
})

describe('FR-11 failures and retries', () => {
  it('a transient failure is retried without showing FAILED; the next attempt succeeds', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    mockScribeControl.failNext('llm', 'ai_unavailable')
    await expect(runJob(session.id, 0)).rejects.toThrow('ai_unavailable')
    let s = await getSession(session.id)
    expect(s.status).toBe('TRANSCRIBING')
    expect(s.errorMessage).toBeNull()
    expect(s.transcript).toBe(MOCK_TRANSCRIPT) // kept: the retry does not transcribe again

    mockScribeControl.reset()
    await runJob(session.id, 1)
    s = await getSession(session.id)
    expect(s.status).toBe('DRAFT_GENERATED')
    expect(mockScribeControl.calls.filter((c) => c.kind === 'stt')).toHaveLength(0)
  })

  it('the last attempt fails with a safe reason; retry (process) is offered', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    mockScribeControl.failNext('stt', 'ai_unavailable')
    await expect(runJob(session.id, 2)).rejects.toThrow('ai_unavailable')
    const s = await getSession(session.id)
    expect(s.status).toBe('FAILED')
    expect(s.errorMessage).toBe('The AI service could not be reached. Try again in a moment.')

    const retry = await api(server.url, `/ai-scribe/session/${session.id}/process`, {
      token: aProvider,
      method: 'POST',
    })
    expect(retry.status).toBe(200)
    expect(retry.body.data.session.status).toBe('TRANSCRIBING')
    await runJob(session.id)
    expect((await getSession(session.id)).status).toBe('DRAFT_GENERATED')
  })

  it('a non-retryable failure (bad credentials) is final at once', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    mockScribeControl.failNext('stt', 'ai_auth')
    await expect(runJob(session.id, 0)).rejects.toThrow('ai_auth')
    const s = await getSession(session.id)
    expect(s.status).toBe('FAILED')
    expect(s.errorMessage).toMatch(/rejected our credentials/)
  })

  it('a queue outage is a clean 503 and a FAILED session', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    queueDown = true
    const res = await upload(session.id)
    expect(res.status).toBe(503)
    expect((await getSession(session.id)).status).toBe('FAILED')
  })

  it('an unconfigured scribe refuses recording with 503 ai_not_configured', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    process.env.AI_SCRIBE_LLM_PROVIDER = 'disabled'
    resetScribeAi()
    try {
      const caps = await api(server.url, '/ai-scribe/capabilities', { token: aProvider })
      expect(caps.body.data.capabilities).toMatchObject({
        available: false,
        draftingAvailable: false,
      })
      const res = await upload(session.id)
      expect(res.status).toBe(503)
      expect(JSON.stringify(res.body)).toMatch(/not configured/)
    } finally {
      process.env.AI_SCRIBE_LLM_PROVIDER = 'mock'
      resetScribeAi()
    }
  })

  it('the consultation reaches TRANSCRIPT_READY when the draft is done', async () => {
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    const consultation = await adminDb.consultationSession.create({
      data: {
        clinicId: A.clinicId,
        appointmentId: visit.appointmentId,
        providerId: A.providerId,
        patientId: A.users.patient.id,
        status: 'PROCESSING',
        transcriptStatus: 'PROCESSING',
        consentStatus: 'GRANTED',
        aiScribeSessionId: session.id,
        joinToken: crypto.randomBytes(16).toString('hex'),
        joinTokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    await runJob(session.id)
    const c = await adminDb.consultationSession.findUnique({ where: { id: consultation.id } })
    expect(c).toMatchObject({ status: 'TRANSCRIPT_READY', transcriptStatus: 'READY' })
  })
})

describe('B2.6 no PHI in logs, errors or the queue', () => {
  it('a failing job leaves no transcript or model output anywhere it reports', async () => {
    const canary = `PHI-CANARY-${crypto.randomBytes(4).toString('hex')}`
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    // The transcript itself carries the canary (regenerate path reads it back).
    await adminDb.aIScribeSession.update({
      where: { id: session.id },
      data: { transcript: `Provider: hello ${canary}\nPatient: my name is ${canary}` },
    })
    // The model answers with the canary and garbage twice (draft + repair).
    mockScribeControl.llmResponder = () => `I cannot comply. Patient ${canary} said ${canary}.`

    const logged: string[] = []
    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    }
    for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
      console[k] = (...args: unknown[]) => {
        logged.push(
          args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' ')
        )
      }
    }
    let thrown: unknown
    try {
      await runJob(session.id, 0, { regenerateSoapOnly: true })
    } catch (e) {
      thrown = e
    } finally {
      Object.assign(console, originals)
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('ai_bad_output') // what BullMQ keeps as failedReason
    const s = await getSession(session.id)
    expect(s.status).toBe('FAILED')
    expect(s.errorMessage).toMatch(/unusable draft/)
    expect(logged.length).toBeGreaterThan(0)
    for (const line of [
      ...logged,
      s.errorMessage,
      (thrown as Error).message,
      (thrown as Error).stack ?? '',
    ]) {
      expect(line).not.toContain(canary)
    }
  })
})

describe('FR-16 demo guard and tenant isolation', () => {
  it('simulate works when demo is on and is 404 when it is off', async () => {
    const visit = await newVisit()
    const session = await start(visit.visitRecordId)
    process.env.AI_SCRIBE_DEMO_ENABLED = 'false'
    try {
      const off = await api(server.url, `/ai-scribe/session/${session.id}/simulate`, {
        token: aProvider,
        method: 'POST',
      })
      expect(off.status).toBe(404)
    } finally {
      delete process.env.AI_SCRIBE_DEMO_ENABLED
    }
    const on = await api(server.url, `/ai-scribe/session/${session.id}/simulate`, {
      token: aProvider,
      method: 'POST',
    })
    expect(on.status).toBe(200)
    expect(on.body.data.session.patientSummary.nextSteps).toMatch(/4 days/)
    expect(on.body.data.session.transcript).not.toMatch(/Emma/)
  })

  it("another clinic's provider cannot see or act on the session", async () => {
    const { sessionId } = await draftedSession()
    for (const path of [
      `/ai-scribe/session/${sessionId}`,
      `/ai-scribe/session/${sessionId}/longitudinal`,
    ]) {
      expect((await api(server.url, path, { token: bProvider })).status).toBe(404)
    }
    const approve = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: bProvider,
      body: {},
    })
    expect(approve.status).toBe(404)
  })
})

describe('B2.8 longitudinal record', () => {
  it("the next visit's draft sees the prior approved visit, and the panel lists it (audited)", async () => {
    // Visit 1: approved with a recognisable assessment.
    const first = await draftedSession()
    await api(server.url, `/ai-scribe/session/${first.sessionId}/approve`, {
      token: aProvider,
      body: { draft: { assessment: 'PRIOR-ASSESSMENT-MARKER' } },
    })

    // Visit 2: the draft prompt carries the digest; the draft says what changed.
    const visit = await newVisit({ bookingConsent: true })
    const session = await start(visit.visitRecordId)
    await upload(session.id)
    mockScribeControl.reset()
    await runJob(session.id)
    const analysis = mockScribeControl.calls.find((c) => c.kind === 'llm' && c.request?.jsonSchema)!
    expect(analysis.request!.user).toContain(PRIOR_VISITS_MARKER)
    expect(analysis.request!.user).toContain('PRIOR-ASSESSMENT-MARKER')
    expect(analysis.request!.user).not.toMatch(/Synthetic|@example\.test/) // no names or emails
    expect((await getSession(session.id)).timeline.continuity).toMatch(/Since the last visit/)

    const res = await api(server.url, `/ai-scribe/session/${session.id}/longitudinal`, {
      token: aProvider,
    })
    expect(res.status).toBe(200)
    const entry = res.body.data.visits.find((v: any) => v.visitRecordId === first.visitRecordId)
    expect(entry.assessment).toBe('PRIOR-ASSESSMENT-MARKER')
    expect(res.body.data.visits.some((v: any) => v.visitRecordId === visit.visitRecordId)).toBe(
      false
    )
    const reads = await adminDb.auditLog.count({
      where: { entityId: first.visitRecordId, action: 'READ', performedById: A.users.provider.id },
    })
    expect(reads).toBeGreaterThan(0)
  })

  it("another clinic's notes never feed the digest", async () => {
    const digest = await withTenantBypass('test', () =>
      buildPriorDigest(A.users.patient.id, B.clinicId, 'none')
    )
    expect(digest).toBeNull()
  })
})

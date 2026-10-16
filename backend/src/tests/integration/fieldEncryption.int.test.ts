/**
 * B3.2 — field-level encryption against Postgres. Transcripts, SOAP notes
 * (and versions) and intake answers are ciphertext at rest (read with the
 * owner connection, which bypasses the app), plaintext through the API, and
 * existing plaintext rows are migrated by the backfill — which also rotates.
 */
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import { resetFieldKeysForTests } from '../../config/fieldKeys'
import { isSealed, parseEnvelope } from '../../utils/fieldCrypto'
import { encryptPhiFields } from '../../services/fieldEncryptionMaintenance'
import { exportTenantData } from '../../services/dataLifecycleService'

let server: TestServer
let C: ClinicFixture
let provider = ''
let patient = ''

const SOAP = {
  subjective: 'Synthetic S: reports left knee pain for two weeks',
  objective: 'Synthetic O: mild swelling',
  assessment: 'Synthetic A: strain',
  plan: 'Synthetic P: rest and ice',
}

beforeAll(async () => {
  server = await startServer()
  C = await createClinicFixture('fle')
  provider = (await login(server.url, C.users.provider.email)).accessToken
  patient = (await login(server.url, C.users.patient.email)).accessToken
})
afterAll(() => server.close())

const newAppointment = async (dayOffset: number) => {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + dayOffset)
  start.setUTCHours(14, 0, 0, 0)
  return adminDb.appointment.create({
    data: {
      clinicId: C.clinicId,
      providerId: C.providerId,
      serviceId: C.serviceId,
      patientId: C.users.patient.id,
      locationId: C.locationId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      priceAtBooking: new Prisma.Decimal(100),
      status: 'COMPLETED',
    },
  })
}

describe('B3.2 SOAP notes and their versions', () => {
  it('are sealed at rest, readable through the API, and every version stays readable', async () => {
    const apt = await newAppointment(-2)
    const created = await api(server.url, '/visits', {
      token: provider,
      body: { appointmentId: apt.id, ...SOAP },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.visitRecord.id as string
    expect(created.body.data.visitRecord.subjective).toBe(SOAP.subjective)

    const updated = await api(server.url, `/visits/${id}`, {
      method: 'PUT',
      token: provider,
      body: { plan: 'Synthetic P2: physiotherapy' },
    })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)

    // At rest: ciphertext only, bound to its column.
    const raw = await adminDb.visitRecord.findUniqueOrThrow({ where: { id } })
    for (const f of ['subjective', 'objective', 'assessment', 'plan'] as const) {
      expect(isSealed(raw[f]), f).toBe(true)
      expect(parseEnvelope(raw[f]!).label).toBe(`VisitRecord.${f}`)
    }
    expect(JSON.stringify(raw)).not.toContain('knee')
    const versions = await adminDb.visitNoteVersion.findMany({ where: { visitRecordId: id } })
    expect(versions.length).toBe(2)
    expect(versions.every((v) => isSealed(v.subjective) && isSealed(v.plan))).toBe(true)

    // Create + edit are audited by section name / version id — never the text.
    const audit = await adminDb.auditLog.findMany({
      where: { entityId: id, action: { in: ['VISIT_RECORD_CREATED', 'VISIT_RECORD_UPDATED'] } },
      orderBy: { createdAt: 'asc' },
    })
    expect(audit.map((r) => r.action)).toEqual(['VISIT_RECORD_CREATED', 'VISIT_RECORD_UPDATED'])
    expect(audit[1]!.fieldChanged).toBe('plan')
    expect(JSON.stringify(audit)).not.toMatch(/knee|physiotherapy|Synthetic/)

    // Through the API: plaintext, including relations (currentVersion, versions).
    const read = await api(server.url, `/visits/${id}?includeHistory=true`, { token: provider })
    expect(read.status).toBe(200)
    const vr = read.body.data.visitRecord
    expect(vr).toMatchObject({ subjective: SOAP.subjective, plan: 'Synthetic P2: physiotherapy' })
    expect(vr.currentVersion.plan).toBe('Synthetic P2: physiotherapy')
    expect(vr.versions.map((v: { plan: string }) => v.plan)).toEqual([
      SOAP.plan,
      'Synthetic P2: physiotherapy',
    ])
  })
})

describe('B3.2 intake answers', () => {
  it('are sealed at rest and returned as the original JSON to staff', async () => {
    const template = await adminDb.formTemplate.create({
      data: {
        clinicId: C.clinicId,
        name: 'Synthetic intake',
        scope: 'CLINIC',
        fields: [
          { id: 'reason', type: 'text', label: 'Reason', required: true },
          { id: 'age', type: 'number', label: 'Age' },
          { id: 'consent', type: 'checkbox', label: 'Consent', required: true },
        ],
      },
    })
    const answers = { reason: 'Synthetic: knee pain', age: 40, consent: true }
    const res = await api(server.url, '/forms/respond', {
      token: patient,
      body: { templateId: template.id, responses: answers },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.response.responses).toEqual(answers)

    const raw = await adminDb.formResponse.findUniqueOrThrow({
      where: { id: res.body.data.response.id },
    })
    expect(isSealed(raw.responses)).toBe(true)
    expect(JSON.stringify(raw.responses)).not.toContain('knee')

    const admin = (await login(server.url, C.users.admin.email)).accessToken
    const list = await api(server.url, `/forms/patient/${C.users.patient.id}`, { token: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.responses.find((r: { id: string }) => r.id === raw.id).responses).toEqual(
      answers
    )
  })
})

describe('B3.2 scribe transcripts, AI drafts and voice transcripts', () => {
  it('JSON and text columns round-trip through the app client; ciphertext at rest', async () => {
    const draft = { subjective: 'Synthetic draft S', plan: 'Synthetic draft P' }
    const session = await withTenantBypass('test:fle', () =>
      prisma.aIScribeSession.create({
        data: {
          clinicId: C.clinicId,
          visitRecordId: C.visitRecordId,
          providerId: C.providerId,
          transcript: 'Synthetic transcript: doctor and patient talk about the knee',
          aiDraft: draft,
          timeline: [{ symptom: 'pain', duration: '2 weeks' }],
          patientSummary: { summary: 'Synthetic summary' },
        },
      })
    )
    expect(session.aiDraft).toEqual(draft)
    const raw = await adminDb.aIScribeSession.findUniqueOrThrow({ where: { id: session.id } })
    for (const f of ['transcript', 'aiDraft', 'timeline', 'patientSummary'] as const) {
      expect(isSealed(raw[f]), f).toBe(true)
    }

    // Nested include: visit → scribe session JSON opened in place.
    const visit = await withTenantBypass('test:fle', () =>
      prisma.visitRecord.findFirstOrThrow({
        where: { id: C.visitRecordId, clinicId: C.clinicId },
        include: { aiSessions: true },
      })
    )
    expect(visit.aiSessions.find((s) => s.id === session.id)?.timeline).toEqual([
      { symptom: 'pain', duration: '2 weeks' },
    ])

    const call = await withTenantBypass('test:fle', () =>
      prisma.voiceCall.create({
        data: {
          clinicId: C.clinicId,
          transcript: [{ role: 'caller', content: 'Synthetic caller asks about knee', ts: 1 }],
          summary: 'Synthetic call summary',
        },
      })
    )
    const rawCall = await adminDb.voiceCall.findUniqueOrThrow({ where: { id: call.id } })
    expect(isSealed(rawCall.transcript)).toBe(true)
    expect(isSealed(rawCall.summary)).toBe(true)
    expect(call.summary).toBe('Synthetic call summary')
  })

  it('a filter on an encrypted column is refused instead of silently matching nothing', async () => {
    await expect(
      withTenantBypass('test:fle', () =>
        prisma.aIScribeSession.findMany({
          where: { clinicId: C.clinicId, transcript: { contains: 'knee' } },
        })
      )
    ).rejects.toMatchObject({ code: 'encrypted_field_filter' })
  })

  it('the tenant export carries plaintext (decrypted by the app client)', async () => {
    const exported = await exportTenantData(C.tenantId)
    const visits = exported.data.VisitRecord as { subjective: string | null }[]
    expect(visits.some((v) => v.subjective?.startsWith('Synthetic S'))).toBe(true)
    expect(JSON.stringify(exported)).not.toContain('fle:v1:')
  })
})

describe('B3.2 migration of existing rows (ops:encrypt-phi)', () => {
  it('seals legacy plaintext, is idempotent, and rotates to a new key', async () => {
    // The fixture wrote a plaintext SOAP note through the owner connection —
    // exactly what rows written before B3.2 look like.
    const before = await adminDb.visitRecord.findUniqueOrThrow({ where: { id: C.visitRecordId } })
    expect(before.subjective).toBe('Synthetic note: no real patient data.')
    const legacyForm = await adminDb.formResponse.create({
      data: {
        clinicId: C.clinicId,
        templateId: (
          await adminDb.formTemplate.findFirstOrThrow({ where: { clinicId: C.clinicId } })
        ).id,
        patientId: C.users.patient.id,
        responses: { reason: 'Synthetic legacy answer' },
      },
    })

    const dry = await encryptPhiFields({ clinicIds: [C.clinicId], dryRun: true })
    expect(dry.VisitRecord!.sealed).toBeGreaterThanOrEqual(1)
    expect(
      isSealed(
        (await adminDb.visitRecord.findUniqueOrThrow({ where: { id: C.visitRecordId } })).subjective
      )
    ).toBe(false)

    const first = await encryptPhiFields({ clinicIds: [C.clinicId] })
    expect(first.VisitRecord!.sealed).toBeGreaterThanOrEqual(1)
    expect(first.FormResponse!.sealed).toBeGreaterThanOrEqual(1)
    const after = await adminDb.visitRecord.findUniqueOrThrow({ where: { id: C.visitRecordId } })
    expect(isSealed(after.subjective)).toBe(true)
    expect(
      isSealed(
        (await adminDb.formResponse.findUniqueOrThrow({ where: { id: legacyForm.id } })).responses
      )
    ).toBe(true)

    // Reads are unchanged for the app.
    const read = await api(server.url, `/visits/${C.visitRecordId}`, { token: provider })
    expect(read.body.data.visitRecord.subjective).toBe('Synthetic note: no real patient data.')

    // Idempotent.
    const second = await encryptPhiFields({ clinicIds: [C.clinicId] })
    for (const [m, r] of Object.entries(second))
      expect(r, m).toMatchObject({ sealed: 0, resealed: 0, failed: 0 })

    // Rotation: add a key, make it active, re-run → every value re-sealed with it.
    const prevKeys = process.env.FIELD_ENCRYPTION_KEYS!
    const prevActive = process.env.FIELD_ENCRYPTION_ACTIVE_KID!
    process.env.FIELD_ENCRYPTION_KEYS = `${prevKeys},it2:${crypto.randomBytes(32).toString('hex')}`
    process.env.FIELD_ENCRYPTION_ACTIVE_KID = 'it2'
    resetFieldKeysForTests()
    try {
      const rotated = await encryptPhiFields({ clinicIds: [C.clinicId] })
      expect(rotated.VisitRecord!.resealed).toBeGreaterThanOrEqual(1)
      expect(Object.values(rotated).every((r) => r.failed === 0)).toBe(true)
      const r2 = await adminDb.visitRecord.findUniqueOrThrow({ where: { id: C.visitRecordId } })
      expect(parseEnvelope(r2.subjective!).kid).toBe('it2')
      const again = await api(server.url, `/visits/${C.visitRecordId}`, { token: provider })
      expect(again.body.data.visitRecord.subjective).toBe('Synthetic note: no real patient data.')
    } finally {
      process.env.FIELD_ENCRYPTION_KEYS = prevKeys
      process.env.FIELD_ENCRYPTION_ACTIVE_KID = prevActive
      resetFieldKeysForTests()
    }
  })
})

/**
 * B3.3 — treatment plans, prescriptions and intake forms over HTTP against
 * Postgres (enforce + RLS): malformed input is rejected by Zod (400, the
 * shared parity cases), every write is audited with before/after values, and
 * every write is clinic-scoped.
 */
import fs from 'fs'
import path from 'path'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

interface Case {
  case: string
  payload: Record<string, unknown>
}
const cases = JSON.parse(
  fs
    .readFileSync(
      path.resolve(__dirname, '../../../../shared/validation-cases/clinical-records.json'),
      'utf8'
    )
    .replace('"@@LONG_5001@@"', JSON.stringify('x'.repeat(5001)))
) as Record<string, { invalid: Case[] }>

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let aProvider = ''
let aAdmin = ''
let aPatient = ''
let bAdmin = ''
let disciplineA = ''
let disciplineB = ''

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('rec-a')
  B = await createClinicFixture('rec-b')
  aProvider = (await login(server.url, A.users.provider.email)).accessToken
  aAdmin = (await login(server.url, A.users.admin.email)).accessToken
  aPatient = (await login(server.url, A.users.patient.email)).accessToken
  bAdmin = (await login(server.url, B.users.admin.email)).accessToken
  disciplineA = (await adminDb.discipline.findFirstOrThrow({ where: { clinicId: A.clinicId } })).id
  disciplineB = (await adminDb.discipline.findFirstOrThrow({ where: { clinicId: B.clinicId } })).id
})
afterAll(() => server.close())

const auditFor = (entityId: string) =>
  adminDb.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })

describe('B3.3 treatment plans', () => {
  it.each(cases.treatmentPlanCreate!.invalid.map((c) => [c.case, c.payload] as const))(
    'rejects malformed create (400): %s',
    async (_n, payload) => {
      const before = await adminDb.treatmentPlan.count({ where: { clinicId: A.clinicId } })
      const res = await api(server.url, '/treatment-plans', { token: aProvider, body: payload })
      expect(res.status).toBe(400)
      expect(await adminDb.treatmentPlan.count({ where: { clinicId: A.clinicId } })).toBe(before)
    }
  )

  it('create + update are audited with before/after values', async () => {
    const created = await api(server.url, '/treatment-plans', {
      token: aProvider,
      body: {
        patientId: A.users.patient.id,
        disciplineId: disciplineA,
        name: 'Synthetic knee plan',
        totalSessions: 6,
        startDate: '2026-10-01',
        goals: ['Walk'],
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.treatmentPlan.id as string
    expect(created.body.data.treatmentPlan.clinicId).toBe(A.clinicId)

    const updated = await api(server.url, `/treatment-plans/${id}`, {
      method: 'PUT',
      token: aProvider,
      body: { sessionsCompleted: 2, name: 'Synthetic knee plan v2' },
    })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)

    const rows = await auditFor(id)
    expect(rows.map((r) => r.action)).toEqual(['TREATMENT_PLAN_CREATED', 'TREATMENT_PLAN_UPDATED'])
    expect(rows[0]).toMatchObject({ clinicId: A.clinicId, performedById: A.users.provider.id })
    expect(rows[1]!.oldValue).toMatchObject({ name: 'Synthetic knee plan', sessionsCompleted: 0 })
    expect(rows[1]!.newValue).toMatchObject({
      name: 'Synthetic knee plan v2',
      sessionsCompleted: 2,
    })
    expect(rows[1]!.fieldChanged).toMatch(/sessionsCompleted/)

    // Malformed update is rejected and changes nothing.
    const bad = await api(server.url, `/treatment-plans/${id}`, {
      method: 'PUT',
      token: aProvider,
      body: { status: 'COMPLETED' },
    })
    expect(bad.status).toBe(400)
    expect((await adminDb.treatmentPlan.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE')

    // Another clinic cannot read or change it.
    expect([403, 404]).toContain(
      (await api(server.url, `/treatment-plans/${id}`, { token: bAdmin })).status
    )
    expect([403, 404]).toContain(
      (
        await api(server.url, `/treatment-plans/${id}/discontinue`, {
          method: 'PUT',
          token: bAdmin,
        })
      ).status
    )
    expect((await adminDb.treatmentPlan.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE')
  })

  it('a plan cannot be attached to another clinic’s patient or discipline', async () => {
    const otherPatient = await api(server.url, '/treatment-plans', {
      token: aProvider,
      body: {
        patientId: B.users.patient.id,
        disciplineId: disciplineA,
        name: 'Plan',
        totalSessions: 1,
        startDate: '2026-10-01',
      },
    })
    expect([403, 404]).toContain(otherPatient.status)
    const otherDiscipline = await api(server.url, '/treatment-plans', {
      token: aProvider,
      body: {
        patientId: A.users.patient.id,
        disciplineId: disciplineB,
        name: 'Plan',
        totalSessions: 1,
        startDate: '2026-10-01',
      },
    })
    expect(otherDiscipline.status).toBe(404)
    expect(await adminDb.treatmentPlan.count({ where: { patientId: B.users.patient.id } })).toBe(0)
  })
})

describe('B3.3 prescriptions', () => {
  let completedAppointmentId = ''
  beforeAll(async () => {
    const start = new Date(Date.now() - 3 * 86_400_000)
    start.setUTCHours(10, 0, 0, 0)
    completedAppointmentId = (
      await adminDb.appointment.create({
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
        },
      })
    ).id
  })

  it.each(cases.prescriptionCreate!.invalid.map((c) => [c.case, c.payload] as const))(
    'rejects malformed create (400): %s',
    async (_n, payload) => {
      const res = await api(server.url, '/prescriptions', { token: aProvider, body: payload })
      expect(res.status).toBe(400)
    }
  )

  it('a valid prescription is created for the appointment’s patient and audited', async () => {
    const res = await api(server.url, '/prescriptions', {
      token: aProvider,
      body: { appointmentId: completedAppointmentId, notes: 'Synthetic: vitamin D daily' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const rx = res.body.data.prescription
    expect(rx).toMatchObject({ clinicId: A.clinicId, patientId: A.users.patient.id })
    const rows = await auditFor(rx.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'PRESCRIPTION_CREATED',
      clinicId: A.clinicId,
      performedById: A.users.provider.id,
    })
    // Free text is not copied into the audit log.
    expect(JSON.stringify(rows[0]!.newValue)).not.toContain('vitamin')
  })

  it('refuses a patientId that is not the appointment’s patient', async () => {
    const res = await api(server.url, '/prescriptions', {
      token: aProvider,
      body: {
        appointmentId: completedAppointmentId,
        patientId: B.users.patient.id,
        notes: 'Synthetic',
      },
    })
    expect(res.status).toBe(400)
    expect(await adminDb.prescription.count({ where: { patientId: B.users.patient.id } })).toBe(0)
  })

  it('another clinic’s appointment is not found; another clinic’s staff see nothing', async () => {
    const res = await api(server.url, '/prescriptions', {
      token: aProvider,
      body: { appointmentId: B.appointmentId, notes: 'Synthetic' },
    })
    expect(res.status).toBe(404)
    const list = await api(server.url, `/prescriptions/patient/${A.users.patient.id}`, {
      token: bAdmin,
    })
    expect(list.status === 200 ? list.body.data.prescriptions : []).toEqual([])
  })
})

describe('B3.3 intake form templates and responses', () => {
  let templateId = ''

  it.each(cases.formTemplateCreate!.invalid.map((c) => [c.case, c.payload] as const))(
    'rejects malformed template (400): %s',
    async (_n, payload) => {
      const res = await api(server.url, '/forms/templates', { token: aAdmin, body: payload })
      expect(res.status).toBe(400)
    }
  )

  it('template create/update are audited with before/after values', async () => {
    const created = await api(server.url, '/forms/templates', {
      token: aAdmin,
      body: {
        name: 'Synthetic intake',
        scope: 'CLINIC',
        fields: [
          { id: 'reason', type: 'text', label: 'Reason', required: true },
          { id: 'age', type: 'number', label: 'Age' },
          {
            id: 'pain',
            type: 'select',
            label: 'Pain',
            options: [
              { value: 'low', label: 'Low' },
              { value: 'high', label: 'High' },
            ],
          },
          { id: 'consent', type: 'checkbox', label: 'Consent', required: true },
        ],
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    templateId = created.body.data.template.id
    const renamed = await api(server.url, `/forms/templates/${templateId}`, {
      method: 'PUT',
      token: aAdmin,
      body: { name: 'Synthetic intake v2' },
    })
    expect(renamed.status).toBe(200)
    const rows = await auditFor(templateId)
    expect(rows.map((r) => r.action)).toEqual(['FORM_TEMPLATE_CREATED', 'FORM_TEMPLATE_UPDATED'])
    expect(rows[1]!.oldValue).toMatchObject({ name: 'Synthetic intake', fieldCount: 4 })
    expect(rows[1]!.newValue).toMatchObject({ name: 'Synthetic intake v2', fieldCount: 4 })

    expect([403, 404]).toContain(
      (
        await api(server.url, `/forms/templates/${templateId}`, {
          method: 'PUT',
          token: bAdmin,
          body: { name: 'hijack' },
        })
      ).status
    )
  })

  it('answers that do not satisfy the template are rejected (400)', async () => {
    for (const responses of [
      { age: 40, consent: true }, // missing required
      { reason: 'x', age: 'forty', consent: true }, // wrong type
      { reason: 'x', pain: 'extreme', consent: true }, // not an option
      { reason: 'x', consent: false }, // required checkbox
      { reason: 'x', consent: true, injected: 'y' }, // unknown field
    ]) {
      const res = await api(server.url, '/forms/respond', {
        token: aPatient,
        body: { templateId, responses },
      })
      expect(res.status, JSON.stringify(responses)).toBe(400)
    }
    expect(await adminDb.formResponse.count({ where: { templateId } })).toBe(0)
  })

  it('a valid response is stored and audited; a patient cannot submit for someone else', async () => {
    const ok = await api(server.url, '/forms/respond', {
      token: aPatient,
      body: { templateId, responses: { reason: 'Synthetic', age: 40, pain: 'low', consent: true } },
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    const rows = await auditFor(ok.body.data.response.id)
    expect(rows[0]).toMatchObject({ action: 'FORM_RESPONSE_SUBMITTED', clinicId: A.clinicId })

    const forged = await api(server.url, '/forms/respond', {
      token: aPatient,
      body: {
        templateId,
        patientId: B.users.patient.id,
        responses: { reason: 'x', consent: true },
      },
    })
    expect(forged.status).toBe(403)
  })

  it('a patient cannot answer another clinic’s template', async () => {
    const bTemplate = await adminDb.formTemplate.create({
      data: {
        clinicId: B.clinicId,
        name: 'B intake',
        scope: 'CLINIC',
        fields: [{ id: 'reason', type: 'text', label: 'Reason' }],
      },
    })
    const res = await api(server.url, '/forms/respond', {
      token: aPatient,
      body: { templateId: bTemplate.id, responses: { reason: 'x' } },
    })
    expect(res.status).toBe(404)
  })
})

/**
 * B0.1.5 — cross-tenant negative suite. A clinic-A actor (every role) asks
 * for clinic-B's invoice, appointment, patient, visit record and file; every
 * request must be refused (403/404) and nothing of clinic B may come back.
 *
 * B0.1.3 — Postgres RLS is live for the app's connection role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
const tokens: Record<string, string> = {}

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('iso-a')
  B = await createClinicFixture('iso-b')
  for (const [role, user] of Object.entries(A.users)) {
    tokens[role] = (await login(server.url, user.email)).accessToken
  }
})

afterAll(async () => {
  await server.close()
})

const REFUSED = [403, 404]

describe('clinic A actors cannot reach clinic B records', () => {
  const staffTargets = () =>
    [
      ['invoice', `/invoices/${B.invoiceId}`],
      ['invoice by appointment', `/invoices/appointment/${B.appointmentId}`],
      ['appointment', `/appointments/${B.appointmentId}`],
      ['appointment timeline', `/appointments/${B.appointmentId}/timeline`],
      ['patient appointments', `/appointments/patient/${B.users.patient.id}`],
      ['patient entitlements', `/patients/${B.users.patient.id}/entitlements`],
      ['patient files', `/files/patient/${B.users.patient.id}`],
      ['file download', `/files/${B.patientFileId}/download`],
      ['visit record', `/visits/${B.visitRecordId}`],
      ['visit by appointment', `/visits/appointment/${B.appointmentId}`],
      ['patient visits', `/visits/patient/${B.users.patient.id}`],
    ] as const

  for (const role of ['admin', 'provider', 'frontDesk'] as const) {
    it(`${role}: every clinic-B resource is refused or empty`, async () => {
      for (const [name, path] of staffTargets()) {
        const res = await api(server.url, path, { token: tokens[role] })
        const leaked = JSON.stringify(res.body ?? '').includes(B.clinicId)
        // List endpoints may legitimately answer 200 with an empty list — but
        // never with clinic-B rows.
        const ok = REFUSED.includes(res.status) || (res.status === 200 && !leaked)
        expect(
          ok,
          `${role} ${name} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`
        ).toBe(true)
        expect(leaked, `${role} ${name} leaked clinic B data`).toBe(false)
      }
    })
  }

  it('patient: clinic-B records are refused, own records still load', async () => {
    const own = await api(server.url, '/appointments/my', { token: tokens.patient })
    expect(own.status).toBe(200)
    expect(JSON.stringify(own.body)).toContain(A.appointmentId)
    expect(JSON.stringify(own.body)).not.toContain(B.appointmentId)

    for (const path of [
      `/appointments/${B.appointmentId}`,
      `/visits/${B.visitRecordId}`,
      `/files/patient/me/${B.patientFileId}/download`,
      `/invoices/${B.invoiceId}`,
    ]) {
      const res = await api(server.url, path, { token: tokens.patient })
      expect(REFUSED, `patient ${path} → ${res.status}`).toContain(res.status)
    }
  })

  it('a clinicId parameter naming clinic B is rejected, not honoured', async () => {
    const res = await api(server.url, `/appointments/my?clinicId=${B.clinicId}`, {
      token: tokens.patient,
    })
    expect(JSON.stringify(res.body ?? '')).not.toContain(B.appointmentId)
  })

  it('same-clinic access still works (no false positives)', async () => {
    expect(
      (await api(server.url, `/invoices/${A.invoiceId}`, { token: tokens.admin })).status
    ).toBe(200)
    expect(
      (await api(server.url, `/appointments/${A.appointmentId}`, { token: tokens.frontDesk }))
        .status
    ).toBe(200)
    expect(
      (await api(server.url, `/visits/${A.visitRecordId}`, { token: tokens.provider })).status
    ).toBe(200)
  })
})

describe('Postgres row-level security is live for the app role (B0.1.3)', () => {
  const appDb = new PrismaClient({ datasourceUrl: process.env.INTEGRATION_DATABASE_URL })
  afterAll(() => appDb.$disconnect())

  it('the app connects as a non-superuser role without BYPASSRLS', async () => {
    const [r] = await appDb.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('a scoped table read without the tenant session variables returns 0 rows', async () => {
    const [row] = await appDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Appointment"`
    expect(Number(row?.n)).toBe(0)
    // ...while the owner sees them.
    expect(await adminDb.appointment.count()).toBeGreaterThan(0)
  })

  it('with clinic A set, only clinic A rows are visible and clinic B inserts are refused', async () => {
    const [, rows] = await appDb.$transaction([
      appDb.$executeRaw`SELECT set_config('app.clinic_ids', ${A.clinicId}, TRUE)`,
      appDb.$queryRaw<{ clinicId: string }[]>`SELECT DISTINCT "clinicId" FROM "Appointment"`,
    ])
    expect(rows.map((r) => r.clinicId)).toEqual([A.clinicId])

    await expect(
      appDb.$transaction([
        appDb.$executeRaw`SELECT set_config('app.clinic_ids', ${A.clinicId}, TRUE)`,
        appDb.$executeRaw`INSERT INTO "Discipline" (id, "clinicId", name, "updatedAt") VALUES ('rls-probe', ${B.clinicId}, 'x', now())`,
      ])
    ).rejects.toThrow(/row-level security/)
  })
})

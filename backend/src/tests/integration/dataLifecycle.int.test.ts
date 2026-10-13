/**
 * B0.6.7 data lifecycle:
 *  - soft-vs-hard delete policy is enforced in code
 *  - customer off-boarding: export is complete and secret-free; destroy removes
 *    every clinic-scoped row and stored file, anonymises accounts, keeps the
 *    audit trail, and leaves other tenants untouched
 */
import fs from 'fs'
import path from 'path'
import * as argon2 from 'argon2'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '../../config/prisma'
import { withTenantContext } from '../../config/tenantContext'
import { UPLOAD_BASE } from '../../config/multer'
import { buildDeletionPlan } from '../../services/dataLifecycleService'
import { adminDb, api, login, startServer, FIXTURE_PASSWORD, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

let server: TestServer
let platform: string
let platformUserId: string

beforeAll(async () => {
  server = await startServer()
  const email = `platform.${Date.now()}@example.test`
  const u = await adminDb.user.create({
    data: {
      name: 'Platform Admin',
      email,
      role: 'PLATFORM_ADMIN',
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
    },
  })
  platformUserId = u.id
  platform = (await login(server.url, email)).accessToken
})
afterAll(() => server.close())

describe('soft-vs-hard delete policy (B0.6.7)', () => {
  it('application code cannot hard-delete PHI records', async () => {
    const fx = await createClinicFixture('delpolicy')
    const ctx = {
      clinicId: fx.clinicId,
      tenantId: fx.tenantId,
      userId: fx.users.admin.id,
      role: 'SUPER_ADMIN',
      bypassReason: null,
    }
    await expect(
      withTenantContext(ctx, () =>
        prisma.visitRecord.delete({ where: { id: fx.visitRecordId, clinicId: fx.clinicId } })
      )
    ).rejects.toMatchObject({ code: 'hard_delete_forbidden' })
    await expect(
      withTenantContext(ctx, () => prisma.invoice.deleteMany({ where: { clinicId: fx.clinicId } }))
    ).rejects.toMatchObject({ code: 'hard_delete_forbidden' })
    expect(await adminDb.visitRecord.count({ where: { id: fx.visitRecordId } })).toBe(1)
  })

  it('patient files are soft-deleted through the API (row kept, flagged)', async () => {
    const fx = await createClinicFixture('softdel')
    const admin = (await login(server.url, fx.users.admin.email)).accessToken
    const res = await api(server.url, `/files/${fx.patientFileId}`, {
      method: 'DELETE',
      token: admin,
    })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const row = await adminDb.patientFile.findUnique({ where: { id: fx.patientFileId } })
    expect(row?.isDeleted).toBe(true)
  })
})

describe('customer off-boarding (B0.6.7)', () => {
  let A: ClinicFixture
  let B: ClinicFixture
  let filePath = ''

  beforeAll(async () => {
    A = await createClinicFixture('offboard-a')
    B = await createClinicFixture('offboard-b')
    // Activity that must survive (audit) or be destroyed (everything else).
    await login(server.url, A.users.admin.email)
    const file = await adminDb.patientFile.findUniqueOrThrow({ where: { id: A.patientFileId } })
    filePath = path.join(UPLOAD_BASE, file.storagePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'synthetic')
  })

  it('the deletion plan covers every clinic-scoped model', () => {
    const planned = new Set(buildDeletionPlan().map((p) => p.model))
    const scoped = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'clinicId'))
      .map((m) => m.name)
      .filter((n) => !['AuditLog', 'User', 'ScribeTemplate'].includes(n))
    expect(scoped.filter((n) => !planned.has(n))).toEqual([])
    for (const child of [
      'InvoiceItem',
      'VisitNoteVersion',
      'CartItem',
      'ProviderService',
      'VoiceCallEvent',
    ]) {
      expect(planned.has(child), child).toBe(true)
    }
  })

  it('only platform admins can export or off-board', async () => {
    const admin = (await login(server.url, A.users.admin.email)).accessToken
    expect(
      (await api(server.url, `/platform/lifecycle/tenants/${A.tenantId}/export`, { token: admin }))
        .status
    ).toBe(403)
  })

  it('export is complete and contains no secrets', async () => {
    const res = await api(server.url, `/platform/lifecycle/tenants/${A.tenantId}/export`, {
      token: platform,
    })
    expect(res.status).toBe(200)
    const body = JSON.stringify(res.body)
    for (const id of [
      A.appointmentId,
      A.visitRecordId,
      A.invoiceId,
      A.patientFileId,
      A.users.patient.id,
    ]) {
      expect(body).toContain(id)
    }
    expect(body).not.toContain(B.clinicId)
    expect(body).not.toMatch(/\$argon2|"password"|mfaSecret|recoveryCodes/)
    expect(res.headers.get('content-disposition')).toMatch(/attachment/)
  })

  it('a wrong confirmation is refused and destroys nothing', async () => {
    const res = await api(server.url, `/platform/lifecycle/tenants/${A.tenantId}/offboard`, {
      token: platform,
      body: { confirmSlug: 'not-the-slug' },
    })
    expect(res.status).toBe(400)
    expect(await adminDb.appointment.count({ where: { clinicId: A.clinicId } })).toBeGreaterThan(0)
  })

  it('destroys tenant A completely, keeps its audit trail, leaves tenant B intact', async () => {
    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: A.tenantId } })
    const auditBefore = await adminDb.auditLog.count({ where: { clinicId: A.clinicId } })
    const bCounts = await Promise.all([
      adminDb.appointment.count({ where: { clinicId: B.clinicId } }),
      adminDb.visitRecord.count({ where: { clinicId: B.clinicId } }),
      adminDb.invoice.count({ where: { clinicId: B.clinicId } }),
    ])

    const res = await api(server.url, `/platform/lifecycle/tenants/${A.tenantId}/offboard`, {
      token: platform,
      body: { confirmSlug: tenant.slug },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    // Every clinic-scoped and child table is empty for A.
    for (const step of buildDeletionPlan()) {
      const delegate = (
        adminDb as unknown as Record<string, { count: (a: unknown) => Promise<number> }>
      )[step.delegate]!
      expect(await delegate.count({ where: step.where([A.clinicId]) }), step.model).toBe(0)
    }
    // Stored files are gone.
    expect(fs.existsSync(filePath)).toBe(false)
    // Accounts anonymised, unable to sign in, sessions revoked.
    const patient = await adminDb.user.findUniqueOrThrow({ where: { id: A.users.patient.id } })
    expect(patient).toMatchObject({ name: 'Deleted user', isActive: false })
    expect(patient.email).toMatch(/@offboarded\.invalid$/)
    expect(await adminDb.userSession.count({ where: { userId: A.users.admin.id } })).toBe(0)
    expect(
      (
        await api(server.url, '/auth/login', {
          body: { email: A.users.patient.email, password: FIXTURE_PASSWORD },
        })
      ).status
    ).toBe(401)
    // Clinic + tenant tombstoned.
    const clinic = await adminDb.clinic.findUniqueOrThrow({ where: { id: A.clinicId } })
    expect(clinic).toMatchObject({ name: 'Off-boarded clinic', isActive: false, slug: null })
    expect((await adminDb.tenant.findUniqueOrThrow({ where: { id: A.tenantId } })).status).toBe(
      'CANCELED'
    )
    // Audit trail retained (+ the off-boarding row itself).
    expect(await adminDb.auditLog.count({ where: { clinicId: A.clinicId } })).toBe(auditBefore + 1)
    expect(
      await adminDb.auditLog.count({
        where: { clinicId: A.clinicId, action: 'TENANT_OFFBOARDED', performedById: platformUserId },
      })
    ).toBe(1)
    // Tenant B untouched.
    expect(
      await Promise.all([
        adminDb.appointment.count({ where: { clinicId: B.clinicId } }),
        adminDb.visitRecord.count({ where: { clinicId: B.clinicId } }),
        adminDb.invoice.count({ where: { clinicId: B.clinicId } }),
      ])
    ).toEqual(bCounts)
    expect(
      (await adminDb.user.findUniqueOrThrow({ where: { id: B.users.patient.id } })).isActive
    ).toBe(true)
  })
})

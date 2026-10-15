/**
 *  B0.3.1 read-access logging for notes / transcripts / files (and not for ordinary reads)
 *  B0.3.3 AuditLog is append-only: app role has no UPDATE/DELETE; a trigger blocks everyone
 *  B0.3.6 retention ≥ 6 years: the purge removes only rows older than the window
 *  B0.6.5 a failed-auth spike and an anomalous multi-record access each fire an alert,
 *         and alert payloads carry no PHI
 */
import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'
import { purgeExpiredAuditLogs } from '../../services/auditService'
import { UPLOAD_BASE } from '../../config/multer'
import {
  onSecurityAlert,
  resetSecurityMonitor,
  type SecurityAlert,
} from '../../services/securityMonitorService'

let server: TestServer
let C: ClinicFixture
let provider: string
let admin: string

beforeAll(async () => {
  server = await startServer()
  C = await createClinicFixture('audit')
  provider = (await login(server.url, C.users.provider.email)).accessToken
  admin = (await login(server.url, C.users.admin.email)).accessToken
})
afterAll(() => server.close())

const readRows = (entityId: string, userId: string) =>
  adminDb.auditLog.findMany({ where: { entityId, performedById: userId, action: 'READ' } })

describe('B0.3.1 read-access logging', () => {
  it('viewing a visit record (SOAP note) writes a READ row with actor, entity and time', async () => {
    const before = Date.now()
    const res = await api(server.url, `/visits/${C.visitRecordId}`, { token: provider })
    expect(res.status).toBe(200)
    const rows = await readRows(C.visitRecordId, C.users.provider.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ entityType: 'VisitRecord', clinicId: C.clinicId })
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('patient-file download by staff is audited', async () => {
    const file = await adminDb.patientFile.findUniqueOrThrow({ where: { id: C.patientFileId } })
    const onDisk = path.join(UPLOAD_BASE, file.storagePath)
    fs.mkdirSync(path.dirname(onDisk), { recursive: true })
    fs.writeFileSync(onDisk, 'synthetic file body')
    try {
      expect(
        (await api(server.url, `/files/${C.patientFileId}/download`, { token: admin })).status
      ).toBe(200)
    } finally {
      fs.rmSync(onDisk, { force: true })
    }
    const rows = await adminDb.auditLog.findMany({
      where: { entityId: C.patientFileId, performedById: C.users.admin.id },
    })
    expect(rows.map((r) => r.action)).toContain('FILE_DOWNLOADED')
  })

  it('non-sensitive reads are not over-logged', async () => {
    const before = await adminDb.auditLog.count({
      where: { performedById: C.users.admin.id, action: 'READ' },
    })
    expect((await api(server.url, '/services', { token: admin })).status).toBe(200)
    expect((await api(server.url, '/locations', { token: admin })).status).toBe(200)
    const after = await adminDb.auditLog.count({
      where: { performedById: C.users.admin.id, action: 'READ' },
    })
    expect(after).toBe(before)
  })
})

describe('B0.3.3 append-only audit log', () => {
  const appDb = new PrismaClient({ datasourceUrl: process.env.INTEGRATION_DATABASE_URL })
  afterAll(() => appDb.$disconnect())

  it('no application code path updates or deletes AuditLog', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'tests') walk(p)
        } else if (p.endsWith('.ts')) {
          const src = fs.readFileSync(p, 'utf8')
          if (/auditLog\.(update|updateMany|upsert|delete|deleteMany)\s*\(/.test(src))
            offenders.push(p)
          if (
            /(UPDATE|DELETE FROM|TRUNCATE)\s+"?AuditLog"?/i.test(src) &&
            !p.endsWith('auditService.ts')
          ) {
            offenders.push(p)
          }
        }
      }
    }
    walk(path.join(__dirname, '..', '..'))
    expect(offenders).toEqual([])
  })

  it('the app DB role lacks UPDATE and DELETE on AuditLog (verified in pg)', async () => {
    const [p] = await appDb.$queryRaw<{ ins: boolean; upd: boolean; del: boolean }[]>`
      SELECT has_table_privilege(current_user, '"AuditLog"', 'INSERT') AS ins,
             has_table_privilege(current_user, '"AuditLog"', 'UPDATE') AS upd,
             has_table_privilege(current_user, '"AuditLog"', 'DELETE') AS del`
    expect(p).toEqual({ ins: true, upd: false, del: false })
    await expect(appDb.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'x'`)).rejects.toThrow(
      /permission denied/
    )
  })

  it('even the owner cannot UPDATE, TRUNCATE, or DELETE a row inside the 6-year window', async () => {
    const row = await adminDb.auditLog.findFirstOrThrow({ where: { clinicId: C.clinicId } })
    await expect(
      adminDb.$executeRaw`UPDATE "AuditLog" SET action = 'tampered' WHERE id = ${row.id}`
    ).rejects.toThrow(/append-only/)
    await expect(adminDb.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${row.id}`).rejects.toThrow(
      /retained for 6 years/
    )
    await expect(adminDb.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(
      /append-only|foreign key/i
    )
  })
})

describe('B0.3.6 audit retention', () => {
  it('the purge deletes rows older than 6 years and never a row inside the window', async () => {
    const yearsAgo = (y: number) => {
      const d = new Date()
      d.setUTCFullYear(d.getUTCFullYear() - y)
      return d
    }
    const mk = (createdAt: Date, tag: string) =>
      adminDb.auditLog.create({
        data: {
          clinicId: C.clinicId,
          entityType: 'RetentionProbe',
          entityId: tag,
          action: 'PROBE',
          performedById: C.users.admin.id,
          createdAt,
        },
      })
    await mk(yearsAgo(7), 'old-7y')
    await mk(yearsAgo(5), 'recent-5y')
    await mk(new Date(), 'today')

    const deleted = await purgeExpiredAuditLogs(new Date(), adminDb)
    expect(deleted).toBeGreaterThanOrEqual(1)
    const left = await adminDb.auditLog.findMany({
      where: { entityType: 'RetentionProbe', clinicId: C.clinicId },
      select: { entityId: true },
    })
    expect(left.map((r) => r.entityId).sort()).toEqual(['recent-5y', 'today'])
  })

  it('a misconfigured retention below 6 years is refused', async () => {
    process.env.AUDIT_RETENTION_YEARS = '2'
    try {
      await expect(purgeExpiredAuditLogs(new Date(), adminDb)).rejects.toThrow(/≥ 6/)
    } finally {
      delete process.env.AUDIT_RETENTION_YEARS
    }
  })
})

describe('B0.6.5 security alerts', () => {
  it('a simulated failed-auth spike fires one alert with no PHI in the payload', async () => {
    resetSecurityMonitor()
    process.env.ALERT_FAILED_LOGIN_PER_IP_THRESHOLD = '5'
    const alerts: SecurityAlert[] = []
    const off = onSecurityAlert((a) => void alerts.push(a))
    try {
      for (let i = 0; i < 6; i++) {
        await api(server.url, '/auth/login', {
          body: { email: C.users.patient.email, password: 'nope' },
        })
      }
      const spike = alerts.filter((a) => a.kind === 'failed_auth_spike')
      expect(spike).toHaveLength(1)
      const payload = JSON.stringify(spike[0])
      expect(payload).not.toContain(C.users.patient.email)
      expect(payload).not.toMatch(/@example\.test/)
    } finally {
      off()
      delete process.env.ALERT_FAILED_LOGIN_PER_IP_THRESHOLD
    }
  })

  it('an anomalous multi-record access fires an alert naming only ids and counts', async () => {
    resetSecurityMonitor()
    process.env.ALERT_RECORD_ACCESS_THRESHOLD = '3'
    const alerts: SecurityAlert[] = []
    const off = onSecurityAlert((a) => void alerts.push(a))
    try {
      const others = await Promise.all([1, 2].map(() => createClinicFixture('audit-x')))
      // Three distinct visit records in the provider's clinic: reuse the fixture visit + 2 new ones.
      const extra = await Promise.all(
        others.map(async (o, i) => {
          // Distinct 30-minute slots: the provider cannot hold overlapping
          // live appointments (B1.1 exclusion constraint).
          const s = slot(20 + i, 9)
          const appt = await adminDb.appointment.create({
            data: {
              clinicId: C.clinicId,
              providerId: C.providerId,
              serviceId: C.serviceId,
              patientId: C.users.patient.id,
              startTime: new Date(s.startTime),
              endTime: new Date(s.endTime),
              priceAtBooking: 100,
            },
          })
          return adminDb.visitRecord.create({
            data: {
              clinicId: C.clinicId,
              appointmentId: appt.id,
              providerId: C.providerId,
              patientId: C.users.patient.id,
              subjective: `synthetic ${o.label}`,
            },
          })
        })
      )
      for (const id of [C.visitRecordId, ...extra.map((v) => v.id)]) {
        expect((await api(server.url, `/visits/${id}`, { token: provider })).status).toBe(200)
      }
      const anomalies = alerts.filter((a) => a.kind === 'anomalous_record_access')
      expect(anomalies).toHaveLength(1)
      expect(anomalies[0]!.details).toMatchObject({
        userId: C.users.provider.id,
        distinctRecords: 3,
      })
      expect(JSON.stringify(anomalies[0])).not.toMatch(/synthetic|@example\.test/)
    } finally {
      off()
      delete process.env.ALERT_RECORD_ACCESS_THRESHOLD
    }
  })
})

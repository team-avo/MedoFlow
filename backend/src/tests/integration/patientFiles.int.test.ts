/**
 * B3.1 / F3.1 / F3.3 — patient files through presigned URLs, end to end
 * against Postgres (enforce + RLS) with the local presigned-URL driver:
 *  - upload: intent → PUT to the presigned URL → complete (size + content verified)
 *  - every download is a time-limited presigned URL, authorised, tenant-scoped, audited
 *  - tampered / expired / wrong-operation URLs are refused
 *  - no filename in any storage key or URL
 */
import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type ApiResponse, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { resolveStorageRef, UPLOAD_BASE } from '../../services/fileStorage'
import { resolveLocalPath, LocalFileStorage } from '../../services/fileStorage/localDriver'
import { migrateLegacyPatientFiles } from '../../services/patientFileMigration'
import { sweepStalePendingUploads } from '../../services/fileService'
import { withTenantBypass } from '../../config/tenantContext'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
const tokens = {} as Record<'aProvider' | 'aFrontDesk' | 'aPatient' | 'bAdmin' | 'bPatient', string>

const PHI_NAME = 'Quinn-Marlowe-lab-results.pdf'
const PDF = Buffer.from('%PDF-1.7\n% synthetic test document\n1 0 obj << >> endobj\n%%EOF\n')

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('files-a')
  B = await createClinicFixture('files-b')
  for (const [k, fx, role] of [
    ['aProvider', A, 'provider'],
    ['aFrontDesk', A, 'frontDesk'],
    ['aPatient', A, 'patient'],
    ['bAdmin', B, 'admin'],
    ['bPatient', B, 'patient'],
  ] as const) {
    tokens[k] = (await login(server.url, fx.users[role].email)).accessToken
  }
})
afterAll(() => server.close())

const putBytes = (url: string, body: Buffer, headers: Record<string, string>) =>
  fetch(url, { method: 'PUT', headers, body })

/** Full upload through the API; returns the file id. */
async function upload(
  token: string,
  patientId: string,
  body: Buffer = PDF,
  mimeType = 'application/pdf',
  fileName = PHI_NAME
): Promise<{ fileId: string; complete: ApiResponse }> {
  const intent = await api(server.url, '/files/uploads', {
    token,
    body: { patientId, fileName, mimeType, size: body.length, tags: ['lab'] },
  })
  expect(intent.status, JSON.stringify(intent.body)).toBe(201)
  const { fileId, uploadUrl, headers } = intent.body.data
  const put = await putBytes(uploadUrl, body, headers)
  expect(put.status).toBe(200)
  const complete = await api(server.url, `/files/${fileId}/complete`, { token, method: 'POST' })
  return { fileId, complete }
}

describe('B3.1 upload through a presigned URL', () => {
  it('intent → PUT → complete makes the file available, audited without the filename', async () => {
    const intent = await api(server.url, '/files/uploads', {
      token: tokens.aFrontDesk,
      body: {
        patientId: A.users.patient.id,
        fileName: PHI_NAME,
        mimeType: 'application/pdf',
        size: PDF.length,
      },
    })
    expect(intent.status).toBe(201)
    const { fileId, uploadUrl, method, headers, expiresAt } = intent.body.data
    expect(method).toBe('PUT')
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(300_000)
    // F3.3: no filename in the URL or the storage key.
    expect(uploadUrl).not.toContain('Quinn')
    const row = await adminDb.patientFile.findUniqueOrThrow({ where: { id: fileId } })
    expect(row.status).toBe('PENDING')
    const prefix = `local:patient-files/${A.clinicId}/${A.users.patient.id}/`
    expect(row.storagePath.startsWith(prefix)).toBe(true)
    expect(row.storagePath.slice(prefix.length)).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.storagePath).not.toContain('Quinn')

    // PENDING files are invisible.
    const listed = await api(server.url, `/files/patient/${A.users.patient.id}`, {
      token: tokens.aFrontDesk,
    })
    expect(listed.body.data.files.map((f: { id: string }) => f.id)).not.toContain(fileId)

    expect((await putBytes(uploadUrl, PDF, headers)).status).toBe(200)
    const done = await api(server.url, `/files/${fileId}/complete`, {
      token: tokens.aFrontDesk,
      method: 'POST',
    })
    expect(done.status, JSON.stringify(done.body)).toBe(200)

    const after = await adminDb.patientFile.findUniqueOrThrow({ where: { id: fileId } })
    expect(after.status).toBe('AVAILABLE')
    expect(after.uploadedAt).toBeInstanceOf(Date)
    const audit = await adminDb.auditLog.findMany({ where: { entityId: fileId } })
    expect(audit.map((r) => r.action)).toEqual(['FILE_UPLOADED'])
    expect(JSON.stringify(audit[0]!.newValue)).not.toContain('Quinn')
    expect(audit[0]!.ipAddress).toBeTruthy()

    // Minimum necessary listing: no storage reference, no uploader email.
    const list = await api(server.url, `/files/patient/${A.users.patient.id}`, {
      token: tokens.aProvider,
    })
    const item = list.body.data.files.find((f: { id: string }) => f.id === fileId)
    expect(item).toMatchObject({ originalName: PHI_NAME, mimeType: 'application/pdf' })
    expect(item).not.toHaveProperty('storagePath')
    expect(item.uploadedBy).not.toHaveProperty('email')
  })

  it('a body whose bytes do not match the declared type is deleted and rejected (422)', async () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    const { fileId, complete } = await upload(
      tokens.aFrontDesk,
      A.users.patient.id,
      html,
      'application/pdf',
      'x.pdf'
    )
    expect(complete.status).toBe(422)
    expect(complete.body.code).toBe('file_content_mismatch')
    const row = await adminDb.patientFile.findUniqueOrThrow({ where: { id: fileId } })
    expect(row.status).toBe('REJECTED')
    const { key } = resolveStorageRef(row.storagePath)
    expect(fs.existsSync(resolveLocalPath(key))).toBe(false)
    const audit = await adminDb.auditLog.findFirst({ where: { entityId: fileId } })
    expect(audit).toMatchObject({ action: 'FILE_UPLOAD_REJECTED', severity: 'warning' })
  })

  it('the PUT must match the signed size and type; complete before PUT is 409', async () => {
    const intent = await api(server.url, '/files/uploads', {
      token: tokens.aFrontDesk,
      body: {
        patientId: A.users.patient.id,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        size: PDF.length,
      },
    })
    const { fileId, uploadUrl } = intent.body.data
    expect(
      (
        await api(server.url, `/files/${fileId}/complete`, {
          token: tokens.aFrontDesk,
          method: 'POST',
        })
      ).status
    ).toBe(409)
    expect(
      (await putBytes(uploadUrl, Buffer.concat([PDF, PDF]), { 'Content-Type': 'application/pdf' }))
        .status
    ).toBe(403)
    expect((await putBytes(uploadUrl, PDF, { 'Content-Type': 'image/png' })).status).toBe(403)
  })

  it('disallowed types, oversize and empty files are refused before any URL is issued', async () => {
    for (const body of [
      { fileName: 'x.svg', mimeType: 'image/svg+xml', size: 10 },
      { fileName: 'x.html', mimeType: 'text/html', size: 10 },
      { fileName: 'x.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 },
      { fileName: 'x.pdf', mimeType: 'application/pdf', size: 0 },
      { fileName: '../x.pdf', mimeType: 'application/pdf', size: 10 },
    ]) {
      const res = await api(server.url, '/files/uploads', {
        token: tokens.aFrontDesk,
        body: { patientId: A.users.patient.id, ...body },
      })
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('patients cannot upload; staff cannot upload for another clinic’s patient', async () => {
    const asPatient = await api(server.url, '/files/uploads', {
      token: tokens.aPatient,
      body: {
        patientId: A.users.patient.id,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        size: 10,
      },
    })
    expect(asPatient.status).toBe(403)
    const crossTenant = await api(server.url, '/files/uploads', {
      token: tokens.aFrontDesk,
      body: {
        patientId: B.users.patient.id,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        size: 10,
      },
    })
    expect([403, 404]).toContain(crossTenant.status)
    expect(
      await adminDb.patientFile.count({
        where: { patientId: B.users.patient.id, clinicId: A.clinicId },
      })
    ).toBe(0)
  })

  it('stale PENDING uploads are swept: object removed, row REJECTED', async () => {
    const intent = await api(server.url, '/files/uploads', {
      token: tokens.aFrontDesk,
      body: {
        patientId: A.users.patient.id,
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        size: PDF.length,
      },
    })
    const { fileId, uploadUrl, headers } = intent.body.data
    await putBytes(uploadUrl, PDF, headers)
    await adminDb.patientFile.update({
      where: { id: fileId },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    })
    const swept = await withTenantBypass('test:sweep', () => sweepStalePendingUploads())
    expect(swept).toBeGreaterThanOrEqual(1)
    const row = await adminDb.patientFile.findUniqueOrThrow({ where: { id: fileId } })
    expect(row.status).toBe('REJECTED')
    expect(fs.existsSync(resolveLocalPath(resolveStorageRef(row.storagePath).key))).toBe(false)
  })
})

describe('B3.1 downloads are presigned, authorised, tenant-scoped and audited', () => {
  let fileId = ''
  beforeAll(async () => {
    const r = await upload(tokens.aFrontDesk, A.users.patient.id)
    expect(r.complete.status).toBe(200)
    fileId = r.fileId
  })

  it('staff get a short-lived URL that serves the exact bytes as an attachment', async () => {
    const res = await api(server.url, `/files/${fileId}/download-url`, { token: tokens.aProvider })
    expect(res.status).toBe(200)
    const { url, expiresAt, fileName, mimeType } = res.body.data
    expect(fileName).toBe(PHI_NAME)
    expect(mimeType).toBe('application/pdf')
    expect(url).not.toContain('Quinn')
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(300_000)

    const blob = await fetch(url)
    expect(blob.status).toBe(200)
    expect(Buffer.from(await blob.arrayBuffer()).equals(PDF)).toBe(true)
    expect(blob.headers.get('content-type')).toBe('application/pdf')
    expect(blob.headers.get('content-disposition')).toBe('attachment')
    expect(blob.headers.get('x-content-type-options')).toBe('nosniff')
    expect(blob.headers.get('cache-control')).toBe('no-store')

    const reads = await adminDb.auditLog.findMany({
      where: { entityId: fileId, performedById: A.users.provider.id },
    })
    expect(reads.map((r) => r.action)).toEqual(['READ'])
  })

  it('the patient gets their own file; one audit row per access', async () => {
    const res = await api(server.url, `/files/patient/me/${fileId}/download-url`, {
      token: tokens.aPatient,
    })
    expect(res.status).toBe(200)
    expect((await fetch(res.body.data.url)).status).toBe(200)
    const rows = await adminDb.auditLog.findMany({
      where: { entityId: fileId, performedById: A.users.patient.id },
    })
    expect(rows.map((r) => r.action)).toEqual(['READ'])
  })

  it('another clinic’s staff and patients are refused (no URL issued)', async () => {
    const before = await adminDb.auditLog.count({ where: { entityId: fileId, action: 'READ' } })
    expect([403, 404]).toContain(
      (await api(server.url, `/files/${fileId}/download-url`, { token: tokens.bAdmin })).status
    )
    expect([403, 404]).toContain(
      (
        await api(server.url, `/files/patient/me/${fileId}/download-url`, {
          token: tokens.bPatient,
        })
      ).status
    )
    expect([403, 404]).toContain(
      (await api(server.url, `/files/${fileId}`, { method: 'DELETE', token: tokens.bAdmin })).status
    )
    expect(await adminDb.auditLog.count({ where: { entityId: fileId, action: 'READ' } })).toBe(
      before
    )
    expect((await adminDb.patientFile.findUniqueOrThrow({ where: { id: fileId } })).isDeleted).toBe(
      false
    )
  })

  it('tampered, wrong-operation and expired URLs are refused (403)', async () => {
    const { url } = (
      await api(server.url, `/files/${fileId}/download-url`, { token: tokens.aProvider })
    ).body.data as { url: string }
    const [prefix, token] = url.split('/blob/')
    const [payload, sig] = token!.split('.')
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    forged.exp = Date.now() + 86_400_000
    const forgedToken = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`
    expect((await fetch(`${prefix}/blob/${forgedToken}`)).status).toBe(403)
    // A download URL cannot be used to overwrite the object.
    expect(
      (await putBytes(url, Buffer.from('x'), { 'Content-Type': 'application/pdf' })).status
    ).toBe(403)

    const prev = process.env.FILE_URL_TTL_SECONDS
    process.env.FILE_URL_TTL_SECONDS = '1'
    try {
      const short = await api(server.url, `/files/${fileId}/download-url`, {
        token: tokens.aProvider,
      })
      await new Promise((r) => setTimeout(r, 1200))
      expect((await fetch(short.body.data.url)).status).toBe(403)
    } finally {
      process.env.FILE_URL_TTL_SECONDS = prev
    }
  })

  it('a soft-deleted file can no longer be downloaded', async () => {
    const r = await upload(tokens.aFrontDesk, A.users.patient.id)
    const del = await api(server.url, `/files/${r.fileId}`, {
      method: 'DELETE',
      token: tokens.aProvider,
    })
    expect(del.status).toBe(200)
    expect(
      (await api(server.url, `/files/${r.fileId}/download-url`, { token: tokens.aProvider })).status
    ).toBe(404)
    const audit = await adminDb.auditLog.findFirst({
      where: { entityId: r.fileId, action: 'FILE_DELETED' },
    })
    expect(audit?.oldValue).toMatchObject({ isDeleted: false })
    expect(JSON.stringify(audit)).not.toContain('Quinn')
  })

  it('legacy disk files move to an opaque key in the store (ops:migrate-patient-files)', async () => {
    // A row as the old in-process upload wrote it: filename in the path.
    const legacyPath = `${A.clinicId}/${A.users.patient.id}/Quinn_Marlowe_scan-1700000000000.pdf`
    const onDisk = path.join(UPLOAD_BASE, legacyPath)
    fs.mkdirSync(path.dirname(onDisk), { recursive: true })
    fs.writeFileSync(onDisk, PDF)
    const legacy = await adminDb.patientFile.create({
      data: {
        clinicId: A.clinicId,
        patientId: A.users.patient.id,
        uploadedById: A.users.admin.id,
        originalName: 'Quinn Marlowe scan.pdf',
        storagePath: legacyPath,
        mimeType: 'application/pdf',
        size: PDF.length,
      },
    })

    const dry = await migrateLegacyPatientFiles(new LocalFileStorage(), {
      clinicIds: [A.clinicId],
      dryRun: true,
    })
    expect(dry.migrated).toBe(0)
    expect(fs.existsSync(onDisk)).toBe(true)

    const report = await migrateLegacyPatientFiles(new LocalFileStorage(), {
      clinicIds: [A.clinicId],
    })
    expect(report.migrated).toBe(1)
    // The fixture's row has no file on disk: reported, left alone.
    expect(report.missing).toContain(A.patientFileId)
    expect(report.failed).toEqual([])
    const moved = await adminDb.patientFile.findUniqueOrThrow({ where: { id: legacy.id } })
    expect(moved.storagePath.startsWith(`local:patient-files/${A.clinicId}/`)).toBe(true)
    expect(moved.storagePath).not.toContain('Quinn')
    expect(fs.existsSync(onDisk)).toBe(false)

    const grant = await api(server.url, `/files/${legacy.id}/download-url`, {
      token: tokens.aProvider,
    })
    const res = await fetch(grant.body.data.url)
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true)

    // Idempotent.
    const again = await migrateLegacyPatientFiles(new LocalFileStorage(), {
      clinicIds: [A.clinicId],
    })
    expect(again.migrated).toBe(0)
  })

  it('the old streaming routes are gone', async () => {
    expect(
      (await api(server.url, `/files/${fileId}/download`, { token: tokens.aProvider })).status
    ).toBe(404)
    expect(fs.existsSync(UPLOAD_BASE)).toBe(true)
  })
})

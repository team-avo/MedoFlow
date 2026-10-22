/**
 * B3.1 data move: patient files written by the old in-process upload live on
 * the API server's local disk (`uploads/<clinic>/<patient>/<name>-<ts>.ext`,
 * a filename-bearing path). This copies each one into the active object
 * store under an opaque key, re-points the row, and removes the disk copy.
 * Idempotent; rows already in the target store are skipped. Rows whose disk
 * file is gone (Render's disk is ephemeral) are reported, not changed.
 */
import crypto from 'crypto'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import fs from 'fs'
import { LocalFileStorage, resolveLocalPath } from './fileStorage/localDriver'
import { patientFileKey, type FileStorageDriver } from './fileStorage/types'

export interface PatientFileMigrationReport {
  scanned: number
  migrated: number
  /** legacy rows whose file is no longer on disk */
  missing: string[]
  failed: string[]
}

const isLegacyRef = (ref: string) => !ref.startsWith('s3:') && !ref.startsWith('local:')

export async function migrateLegacyPatientFiles(
  target: FileStorageDriver,
  opts: { dryRun?: boolean; clinicIds?: string[] } = {}
): Promise<PatientFileMigrationReport> {
  const local = new LocalFileStorage()
  const report: PatientFileMigrationReport = { scanned: 0, migrated: 0, missing: [], failed: [] }

  await withTenantBypass('ops:migrate-patient-files', async () => {
    const rows = await prisma.patientFile.findMany({
      ...(opts.clinicIds ? { where: { clinicId: { in: opts.clinicIds } } } : {}),
      select: { id: true, clinicId: true, patientId: true, storagePath: true, mimeType: true },
      orderBy: { createdAt: 'asc' },
    })
    for (const row of rows.filter((r) => isLegacyRef(r.storagePath))) {
      report.scanned++
      const legacyKey = row.storagePath.replace(/^\/+/, '')
      try {
        if (!(await local.head(legacyKey))) {
          report.missing.push(row.id)
          continue
        }
        if (opts.dryRun) continue
        const body = fs.readFileSync(resolveLocalPath(legacyKey))
        const key = patientFileKey(row.clinicId, row.patientId, crypto.randomUUID())
        await target.putObject(key, body, row.mimeType)
        await prisma.patientFile.update({
          where: { id: row.id, clinicId: row.clinicId },
          data: { storagePath: target.refFor(key) },
        })
        await local.delete(legacyKey)
        report.migrated++
      } catch {
        report.failed.push(row.id)
      }
    }
  })
  return report
}

/**
 * Move legacy local-disk patient files into object storage (B3.1).
 *
 *   pnpm run ops:migrate-patient-files -- --dry-run
 *   pnpm run ops:migrate-patient-files
 *
 * Needs the API's DATABASE_URL and S3_* settings. Prints counts and row ids
 * only — never filenames.
 */
import 'dotenv/config'
import prisma from '../config/prisma'
import { getPatientFileStorage } from '../services/fileStorage'
import { migrateLegacyPatientFiles } from '../services/patientFileMigration'

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run')
  const target = getPatientFileStorage()
  if (target.kind !== 's3' && process.env.NODE_ENV === 'production') {
    throw new Error('Object storage (S3_*) is not configured')
  }
  const report = await migrateLegacyPatientFiles(target, { dryRun })
  process.stdout.write(`${JSON.stringify({ dryRun, target: target.kind, ...report }, null, 2)}\n`)
  if (report.failed.length > 0) process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    process.stderr.write(
      `migrate-patient-files failed: ${err instanceof Error ? err.message : String(err)}\n`
    )
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())

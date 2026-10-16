/**
 * Seal legacy plaintext / rotate keys for field-level encryption (B3.2).
 *
 *   pnpm run ops:encrypt-phi -- --dry-run   # report only
 *   pnpm run ops:encrypt-phi                # seal + re-seal
 *   pnpm run ops:encrypt-phi -- --clinic <id> [--clinic <id>…]   # staged rollout / one clinic
 *
 * Needs the same DATABASE_URL and FIELD_ENCRYPTION_* settings as the API.
 * Prints counts only — never field values.
 */
import 'dotenv/config'
import prisma from '../config/prisma'
import { initFieldEncryption } from '../config/fieldKeys'
import { encryptPhiFields } from '../services/fieldEncryptionMaintenance'

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const clinicIds = args.flatMap((a, i) => (a === '--clinic' && args[i + 1] ? [args[i + 1]!] : []))
  const ring = await initFieldEncryption()
  if (!ring) throw new Error('No field encryption keys configured (FIELD_ENCRYPTION_*)')
  const report = await encryptPhiFields({
    dryRun,
    ...(clinicIds.length > 0 && { clinicIds }),
  })
  process.stdout.write(
    `${JSON.stringify({ dryRun, activeKid: ring.activeKid, clinicIds, report }, null, 2)}\n`
  )
  if (Object.values(report).some((r) => r.failed > 0)) {
    process.stderr.write('encrypt-phi: some rows could not be opened (missing or wrong key)\n')
    process.exitCode = 1
  }
}

main()
  .catch((err: unknown) => {
    process.stderr.write(
      `encrypt-phi failed: ${err instanceof Error ? err.message : String(err)}\n`
    )
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())

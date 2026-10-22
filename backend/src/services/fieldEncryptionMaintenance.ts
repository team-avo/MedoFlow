/**
 * Backfill and key rotation for field-level encryption (B3.2).
 *
 * Seals every legacy plaintext value of an encrypted column, and re-seals
 * values sealed with a key other than the active one. Idempotent: a second
 * run changes nothing. Runs as `pnpm run ops:encrypt-phi` (src/cli).
 */
import prisma, { findManyAsStored } from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import { getKeyring } from '../config/fieldKeys'
import { ENCRYPTED_FIELDS, isSealed, openField, parseEnvelope } from '../utils/fieldCrypto'

export interface ModelReport {
  scanned: number
  /** rows that held at least one plaintext value */
  sealed: number
  /** rows that held a value sealed with a non-active key */
  resealed: number
  /** rows that could not be opened (unknown key / integrity) — left untouched */
  failed: number
}

type Row = Record<string, unknown> & { id: string; clinicId?: string }
interface Delegate {
  update(args: unknown): Promise<unknown>
}

/** Models whose rows carry clinicId (used in the update's where for the tenant guard). */
const HAS_CLINIC_ID = new Set([
  'VisitRecord',
  'AIScribeSession',
  'ConsultationSession',
  'FormResponse',
  'VoiceCall',
  'RxOrderLine',
  'PatientCommerceProfile',
])

/** Optional scope: only rows of these clinics (staged rollout, tests). */
const clinicFilter = (model: string, clinicIds: string[]): Record<string, unknown> =>
  model === 'VisitNoteVersion'
    ? { visitRecord: { clinicId: { in: clinicIds } } }
    : { clinicId: { in: clinicIds } }

const delegateName = (model: string): string =>
  model === 'AIScribeSession' ? 'aIScribeSession' : model[0]!.toLowerCase() + model.slice(1)

export async function encryptPhiFields(
  opts: { dryRun?: boolean; batchSize?: number; clinicIds?: string[] } = {}
): Promise<Record<string, ModelReport>> {
  const ring = getKeyring()
  if (!ring) throw new Error('Field encryption keys are not configured (FIELD_ENCRYPTION_*)')
  const batchSize = opts.batchSize ?? 200
  const report: Record<string, ModelReport> = {}

  await withTenantBypass('ops:encrypt-phi', async () => {
    for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
      const delegate = (prisma as unknown as Record<string, Delegate>)[delegateName(model)]!
      const r: ModelReport = { scanned: 0, sealed: 0, resealed: 0, failed: 0 }
      const select: Record<string, true> = { id: true }
      if (HAS_CLINIC_ID.has(model)) select.clinicId = true
      for (const f of Object.keys(fields)) select[f] = true

      let cursor: string | undefined
      for (;;) {
        // Values as stored (sealed stays sealed) — the app client would open them.
        const rows = (await findManyAsStored(delegateName(model), {
          select,
          ...(opts.clinicIds ? { where: clinicFilter(model, opts.clinicIds) } : {}),
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })) as Row[]
        if (rows.length === 0) break
        cursor = rows[rows.length - 1]!.id

        for (const row of rows) {
          r.scanned++
          const data: Record<string, unknown> = {}
          let plain = false
          let stale = false
          try {
            for (const field of Object.keys(fields)) {
              const v = row[field]
              if (v === null || v === undefined) continue
              if (isSealed(v)) {
                if (parseEnvelope(v).kid === ring.activeKid) continue
                data[field] = openField(v, field)
                stale = true
              } else {
                data[field] = v
                plain = true
              }
            }
          } catch {
            r.failed++
            continue
          }
          if (plain) r.sealed++
          if (stale) r.resealed++
          if ((plain || stale) && !opts.dryRun) {
            // The Prisma extension seals `data` with the active key on write.
            await delegate.update({
              where: row.clinicId ? { id: row.id, clinicId: row.clinicId } : { id: row.id },
              data,
              select: { id: true },
            })
          }
        }
        if (rows.length < batchSize) break
      }
      report[model] = r
    }
  })
  return report
}

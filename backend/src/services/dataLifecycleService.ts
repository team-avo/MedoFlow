/**
 * Data lifecycle (B0.6.7): customer off-boarding export + secure destruction.
 *
 * Policy (docs/DATA_RETENTION_POLICY.md):
 *  - Application code never hard-deletes PHI or money records; it changes
 *    status or soft-deletes (PatientFile.isDeleted). The Prisma extension
 *    enforces this (`assertDeletePolicy` in config/prisma.ts).
 *  - Hard deletion happens only here, inside a `lifecycle:` bypass scope:
 *      exportTenantData  — complete JSON export of a customer's data
 *      offboardTenant    — destroys every clinic-scoped row and stored object,
 *                          anonymises user accounts, tombstones the clinic/tenant.
 *  - AuditLog rows are retained (6-year HIPAA window, enforced by a DB
 *    trigger). The users and clinic they reference are anonymised, not
 *    deleted, so the audit trail stays intact without carrying PHI.
 *
 * The model list and deletion order are derived from the Prisma schema, so a
 * new clinic-scoped model is covered automatically (a test asserts it).
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import * as argon2 from 'argon2'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import { UPLOAD_BASE, resolveStorageRef } from './fileStorage'
import type { ApiError } from '../types/errors'
import * as storageService from './storageService'
import { logAudit } from './auditService'

type DMMFModel = (typeof Prisma.dmmf.datamodel.models)[number]

/** Kept (anonymised or retained), never deleted by off-boarding. */
const RETAINED_MODELS = new Set(['AuditLog', 'User', 'Clinic', 'Tenant', 'ScribeTemplate'])

export interface PlannedModel {
  model: string
  /** Prisma delegate key, e.g. aIScribeSession */
  delegate: string
  /** Where clause, as a function of the tenant's clinic ids. */
  where: (clinicIds: string[]) => Record<string, unknown>
}

const delegateKey = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)

/**
 * Every model holding a customer's data, in an order that is safe to delete
 * (rows that reference another in-plan model come before it). Clinic-scoped
 * models are matched by clinicId; child tables without clinicId (InvoiceItem,
 * VisitNoteVersion, CartItem, …) through their required parent relation.
 */
export function buildDeletionPlan(
  models: readonly DMMFModel[] = Prisma.dmmf.datamodel.models
): PlannedModel[] {
  const byName = new Map(models.map((m) => [m.name, m]))
  const hasClinic = (m: DMMFModel) => m.fields.some((f) => f.name === 'clinicId')
  const fkFields = (m: DMMFModel) =>
    m.fields.filter(
      (f) => f.kind === 'object' && f.relationFromFields && f.relationFromFields.length > 0
    )

  const scoped = new Map<string, PlannedModel['where']>()
  for (const m of models) {
    if (RETAINED_MODELS.has(m.name)) continue
    if (hasClinic(m)) scoped.set(m.name, (ids) => ({ clinicId: { in: ids } }))
  }
  // Child tables: reachable through a required relation to a clinic-scoped parent.
  let added = true
  while (added) {
    added = false
    for (const m of models) {
      if (scoped.has(m.name) || RETAINED_MODELS.has(m.name)) continue
      const parent = fkFields(m).find(
        (f) =>
          f.isRequired && scoped.has(f.type) && byName.get(f.type) && hasClinic(byName.get(f.type)!)
      )
      if (parent) {
        scoped.set(m.name, (ids) => ({ [parent.name]: { clinicId: { in: ids } } }))
        added = true
      }
    }
  }

  // Edge A → B: A references B with a non-SET NULL FK, so A must go first.
  const edges = new Map<string, Set<string>>()
  for (const name of scoped.keys()) {
    const deps = new Set<string>()
    for (const f of fkFields(byName.get(name)!)) {
      if (f.type !== name && scoped.has(f.type) && f.relationOnDelete !== 'SetNull')
        deps.add(f.type)
    }
    edges.set(name, deps)
  }
  // Kahn's algorithm on "who references me": emit models nobody pending references.
  const order: string[] = []
  const pending = new Set(scoped.keys())
  while (pending.size) {
    const ready = [...pending].filter((candidate) =>
      [...pending].every((other) => other === candidate || !edges.get(other)!.has(candidate))
    )
    if (!ready.length)
      throw new Error(`Deletion plan has a cycle among: ${[...pending].join(', ')}`)
    ready.sort()
    for (const r of ready) {
      order.push(r)
      pending.delete(r)
    }
  }
  return order.map((model) => ({ model, delegate: delegateKey(model), where: scoped.get(model)! }))
}

type Delegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>
  deleteMany: (args: unknown) => Promise<{ count: number }>
}
const delegateOf = (client: unknown, key: string) => (client as Record<string, Delegate>)[key]!

const USER_EXPORT_SELECT = {
  id: true,
  clinicId: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

const clinicIdsOf = async (tenantId: string) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { clinics: { select: { id: true, slug: true, name: true } }, brand: true },
  })
  if (!tenant) {
    const err = new Error('Tenant not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return { tenant, clinicIds: tenant.clinics.map((c) => c.id) }
}

/** Users whose account belongs to this customer: its staff, and patients of no other clinic. */
const tenantUsers = async (clinicIds: string[]) => {
  const staffAndHome = await prisma.user.findMany({
    where: { clinicId: { in: clinicIds } },
    select: { id: true },
  })
  const members = await prisma.patientClinicMembership.findMany({
    where: { clinicId: { in: clinicIds } },
    select: { patientId: true },
  })
  const memberIds = [...new Set(members.map((m) => m.patientId))]
  const elsewhere = await prisma.patientClinicMembership.findMany({
    where: { patientId: { in: memberIds }, clinicId: { notIn: clinicIds } },
    select: { patientId: true },
  })
  const shared = new Set(elsewhere.map((m) => m.patientId))
  const exclusive = new Set([
    ...staffAndHome.map((u) => u.id),
    ...memberIds.filter((id) => !shared.has(id)),
  ])
  return { exclusiveUserIds: [...exclusive], sharedPatientIds: [...shared] }
}

/**
 * Complete export of one customer's data (off-boarding hand-back and
 * patient-rights groundwork). Secrets (password hashes, MFA secrets, tokens)
 * are never exported.
 */
export const exportTenantData = (tenantId: string) =>
  withTenantBypass('lifecycle:export', async () => {
    const { tenant, clinicIds } = await clinicIdsOf(tenantId)
    const { exclusiveUserIds, sharedPatientIds } = await tenantUsers(clinicIds)
    const data: Record<string, unknown[]> = {}
    for (const step of buildDeletionPlan()) {
      data[step.model] = await delegateOf(prisma, step.delegate).findMany({
        where: step.where(clinicIds),
      })
    }
    data.AuditLog = await prisma.auditLog.findMany({ where: { clinicId: { in: clinicIds } } })
    const users = await prisma.user.findMany({
      where: { id: { in: [...exclusiveUserIds, ...sharedPatientIds] } },
      select: USER_EXPORT_SELECT,
    })
    return {
      exportedAt: new Date().toISOString(),
      format: 'medoflow-tenant-export/v1',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
      },
      clinics: tenant.clinics,
      brand: tenant.brand,
      users,
      data,
    }
  })

/** Removes an object referenced by a DB row from local disk or object storage. */
async function deleteStoredObject(ref: string | null | undefined): Promise<void> {
  if (!ref) return
  if (ref.startsWith('s3:')) {
    const [, bucket, ...key] = ref.split(':')
    await storageService.deleteAudio(`${bucket}/${key.join(':')}`)
    return
  }
  if (ref.startsWith('/uploads/') || ref.startsWith('http')) {
    await storageService.deleteAudio(ref)
    return
  }
  const local = path.resolve(UPLOAD_BASE, ref)
  if (local.startsWith(path.resolve(UPLOAD_BASE)) && fs.existsSync(local))
    fs.rmSync(local, { force: true })
}

export interface OffboardResult {
  tenantId: string
  deleted: Record<string, number>
  objectsDeleted: number
  objectErrors: number
  usersAnonymised: number
  auditRowsRetained: number
}

/**
 * Destroys a customer's data. Irreversible: callers must have exported first
 * and pass the tenant slug as confirmation.
 */
export const offboardTenant = (
  tenantId: string,
  opts: { confirmSlug: string; performedById: string }
): Promise<OffboardResult> =>
  withTenantBypass('lifecycle:offboard', async () => {
    const { tenant, clinicIds } = await clinicIdsOf(tenantId)
    if (opts.confirmSlug !== tenant.slug) {
      const err = new Error('Confirmation does not match the tenant slug') as ApiError
      err.statusCode = 400
      throw err
    }

    // Object storage first (references are lost once the rows go).
    const [files, scribe, consults, voice] = await Promise.all([
      prisma.patientFile.findMany({
        where: { clinicId: { in: clinicIds } },
        select: { storagePath: true },
      }),
      prisma.aIScribeSession.findMany({
        where: { clinicId: { in: clinicIds } },
        select: { audioUrl: true },
      }),
      prisma.consultationSession.findMany({
        where: { clinicId: { in: clinicIds } },
        select: { recordingUrl: true },
      }),
      prisma.voiceCall.findMany({
        where: { clinicId: { in: clinicIds } },
        select: { recordingUrl: true },
      }),
    ])
    let objectsDeleted = 0
    let objectErrors = 0
    // Patient files resolve through the file-storage drivers (B3.1).
    for (const f of files) {
      try {
        const { driver, key } = resolveStorageRef(f.storagePath)
        await driver.delete(key)
        objectsDeleted++
      } catch {
        objectErrors++
      }
    }
    const refs = [
      ...scribe.map((s) => s.audioUrl),
      ...consults.map((c) => c.recordingUrl),
      ...voice.map((v) => v.recordingUrl),
    ].filter((r): r is string => Boolean(r))
    for (const ref of refs) {
      try {
        await deleteStoredObject(ref)
        objectsDeleted++
      } catch {
        objectErrors++
      }
    }

    const { exclusiveUserIds, sharedPatientIds } = await tenantUsers(clinicIds)
    const plan = buildDeletionPlan()
    const deleted: Record<string, number> = {}
    const scrambled = await argon2.hash(crypto.randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    })

    await prisma.$transaction(
      async (tx) => {
        // Break optional links that would otherwise block parent deletes.
        await tx.visitRecord.updateMany({
          where: { clinicId: { in: clinicIds } },
          data: { currentVersionId: null },
        })
        await tx.consultationSession.updateMany({
          where: { clinicId: { in: clinicIds } },
          data: { aiScribeSessionId: null },
        })
        await tx.user.updateMany({
          where: { clinicId: { in: clinicIds } },
          data: { customRoleId: null },
        })
        for (const step of plan) {
          const res = await delegateOf(tx, step.delegate).deleteMany({
            where: step.where(clinicIds),
          })
          deleted[step.model] = res.count
        }
        // Accounts: anonymise (audit rows reference them), revoke every session.
        for (const id of exclusiveUserIds) {
          await tx.user.update({
            where: { id },
            data: {
              name: 'Deleted user',
              email: `deleted-${id}@offboarded.invalid`,
              password: scrambled,
              isActive: false,
              permissions: Prisma.DbNull,
              preferences: Prisma.DbNull,
              mfaEnabled: false,
              mfaSecret: null,
              mfaPendingSecret: null,
              mfaRecoveryCodes: Prisma.DbNull,
            },
          })
        }
        await tx.userSession.deleteMany({ where: { userId: { in: exclusiveUserIds } } })
        await tx.refreshToken.deleteMany({ where: { userId: { in: exclusiveUserIds } } })
        await tx.passwordSetupToken.deleteMany({ where: { userId: { in: exclusiveUserIds } } })
        // Patients who also use another clinic keep their account; only this
        // customer's membership rows (already deleted above) are gone.
        void sharedPatientIds

        for (const c of tenant.clinics) {
          await tx.clinic.update({
            where: { id: c.id },
            data: {
              name: 'Off-boarded clinic',
              email: `offboarded-${c.id}@offboarded.invalid`,
              slug: null,
              logoUrl: null,
              themeColor: null,
              isActive: false,
            },
          })
        }
        await tx.brand.deleteMany({ where: { tenantId } })
        await tx.tenant.update({
          where: { id: tenantId },
          data: { name: 'Off-boarded tenant', slug: `offboarded-${tenantId}`, status: 'CANCELED' },
        })
      },
      { timeout: 120_000, maxWait: 10_000 }
    )

    const auditRowsRetained = await prisma.auditLog.count({
      where: { clinicId: { in: clinicIds } },
    })
    for (const clinicId of clinicIds) {
      await logAudit({
        clinicId,
        entityType: 'Tenant',
        entityId: tenantId,
        action: 'TENANT_OFFBOARDED',
        newValue: {
          deleted,
          objectsDeleted,
          objectErrors,
          usersAnonymised: exclusiveUserIds.length,
        },
        performedById: opts.performedById,
        severity: 'critical',
      })
    }
    return {
      tenantId,
      deleted,
      objectsDeleted,
      objectErrors,
      usersAnonymised: exclusiveUserIds.length,
      auditRowsRetained,
    }
  })

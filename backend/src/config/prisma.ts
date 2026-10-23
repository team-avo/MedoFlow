import { PrismaClient } from '@prisma/client'
import {
  getTenantContext,
  getIsolationMode,
  getAllowedClinicIds,
  type TenantContext,
} from './tenantContext'
import { sealWriteArgs, openResult, assertNoEncryptedFilter } from '../utils/fieldCrypto'

// One client per process in development (survives hot reloads).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const basePrisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? (['error', 'warn'] as const) : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma
}

/**
 * Models with a direct `clinicId` column — derived from schema.prisma. Must
 * be kept in sync if new clinic-scoped models are added (a test diffs this
 * list against the Prisma DMMF). User is intentionally omitted (auth
 * primitive; look-ups happen by email/id before any clinic context exists).
 * CartItem/InvoiceItem/etc. inherit scope via their parent. Auth-event
 * audit rows with no clinic are written from public (bypass) scope.
 */
export const CLINIC_SCOPED_MODELS = new Set([
  'AIScribeSession',
  'Appointment',
  'AppointmentSeries',
  'AuditLog',
  'BreakGlassGrant',
  'Cart',
  'CommissionRecord',
  'CommissionRule',
  'ConsultationSession',
  'CustomRole',
  'Discipline',
  'FormResponse',
  'FormTemplate',
  'GoogleCalendarConnection',
  'GoogleCalendarEvent',
  'InventoryItem',
  'Invoice',
  'Location',
  'Membership',
  'Package',
  'PatientClinicMembership',
  'PatientCommerceProfile',
  'PatientFile',
  'PatientPackage',
  'PatientSubscription',
  'Payment',
  'Prescription',
  'Product',
  'Provider',
  'RxOrderLine',
  'RxOrderProposal',
  'Service',
  'Site',
  'SiteAsset',
  'SiteDomain',
  'SiteLead',
  'SitePage',
  'SitePageRevision',
  'SiteRedirect',
  'SlotHold',
  'TreatmentPlan',
  'VisitRecord',
  'VoiceAgentConfig',
  'VoiceCall',
  'WaitlistEntry',
])

/**
 * Models that have a clinicId column but are deliberately NOT guarded:
 *  - User: auth primitive, looked up by email/id before a clinic context exists.
 *  - ScribeTemplate: nullable clinicId (null = global system template); holds no PHI.
 */
export const CLINIC_COLUMN_UNGUARDED_MODELS = new Set(['User', 'ScribeTemplate'])

type WhereLike = Record<string, unknown> | undefined | null

/**
 * Result of reading the clinic constraint out of a where clause:
 *  - string[]  — the query is limited to these clinics
 *  - 'none'    — no clinic constraint at all
 *  - 'invalid' — a clinicId filter the guard can't verify (`not`, `startsWith`, …)
 */
type ClinicConstraint = string[] | 'none' | 'invalid'

function readClinicValue(value: unknown): ClinicConstraint {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    const keys = Object.keys(v)
    if (keys.length === 1 && typeof v.equals === 'string') return [v.equals]
    if (keys.length === 1 && Array.isArray(v.in) && v.in.every((x) => typeof x === 'string')) {
      return v.in
    }
  }
  return 'invalid'
}

/**
 * A where clause is clinic-scoped if:
 *  - top-level `clinicId` is set, OR
 *  - a compound unique key that embeds clinicId is used, e.g.
 *      `{ clinicId_name: { clinicId: 'x', name: 'y' } }`, OR
 *  - any entry in a top-level `AND` array sets `clinicId`.
 *
 * Top-level OR clauses are treated as unscoped — OR-mixing is an easy
 * footgun, and callers can rewrite to AND(clinicId, OR(...)).
 */
export function readWhereClinicConstraint(where: WhereLike): ClinicConstraint {
  if (!where) return 'none'
  if ('clinicId' in where && where.clinicId !== undefined) return readClinicValue(where.clinicId)
  for (const key of Object.keys(where)) {
    if (key.includes('clinicId') && typeof where[key] === 'object' && where[key] !== null) {
      const inner = where[key] as Record<string, unknown>
      if ('clinicId' in inner && inner.clinicId !== undefined)
        return readClinicValue(inner.clinicId)
    }
  }
  const and = where.AND
  const branches = Array.isArray(and) ? and : and && typeof and === 'object' ? [and] : []
  for (const branch of branches) {
    const c = readWhereClinicConstraint(branch as WhereLike)
    if (c !== 'none') return c
  }
  return 'none'
}

export function readCreateClinicConstraint(data: unknown): ClinicConstraint {
  if (!data) return 'none'
  if (Array.isArray(data)) {
    const ids: string[] = []
    for (const d of data) {
      const c = readCreateClinicConstraint(d)
      if (c === 'none' || c === 'invalid') return c
      ids.push(...c)
    }
    return ids.length ? ids : 'none'
  }
  if (typeof data !== 'object') return 'none'
  const d = data as Record<string, unknown>
  if (typeof d.clinicId === 'string') return [d.clinicId]
  // nested clinic connect: { clinic: { connect: { id } } }
  const clinic = d.clinic as { connect?: { id?: unknown } } | undefined
  if (clinic && typeof clinic === 'object') {
    return typeof clinic.connect?.id === 'string' ? [clinic.connect.id] : 'invalid'
  }
  return 'none'
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
])
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert'])

/**
 * A violation message that is safe to log: model, operation and the *keys*
 * of the where/data object only. Values are never logged — they can carry
 * patient names, emails or note text (B0.3.5).
 */
function describeViolation(model: string, op: string, args: unknown): string {
  const a = (args ?? {}) as { where?: unknown; data?: unknown; create?: unknown }
  const keys = (o: unknown) =>
    o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).join(',') : typeof o
  return `${model}.${op} where-keys=[${keys(a.where)}] data-keys=[${keys(a.data ?? a.create)}]`
}

export class TenantScopeError extends Error {
  statusCode: number
  code: 'tenant_scope_required' | 'tenant_scope_mismatch'
  constructor(code: TenantScopeError['code'], model: string, op: string) {
    super(
      code === 'tenant_scope_mismatch'
        ? 'Access denied: resource belongs to another clinic'
        : `Tenant isolation violation: ${model}.${op} called without a clinicId filter. ` +
            'Scope the query with `where: { clinicId, … }` (see clinicScope()), or wrap ' +
            'legitimate cross-tenant operations in `withTenantBypass("reason", () => …)`.'
    )
    this.name = 'TenantScopeError'
    this.code = code
    this.statusCode = code === 'tenant_scope_mismatch' ? 403 : 500
  }
}

/**
 * The tenant guard (B0.1.1 / B0.1.2). Throws (enforce) or logs (warn) when a
 * query on a clinic-scoped model is missing a clinicId filter, or names a
 * clinic the caller doesn't belong to. Exported for unit tests.
 */
export function assertTenantScope(
  model: string,
  operation: string,
  args: unknown,
  ctx: TenantContext | undefined,
  mode = getIsolationMode()
): void {
  if (mode === 'off' || !CLINIC_SCOPED_MODELS.has(model)) return
  if (ctx?.bypassReason) return

  const constraints: ClinicConstraint[] = []
  if (WHERE_OPERATIONS.has(operation)) {
    constraints.push(readWhereClinicConstraint((args as { where?: WhereLike } | undefined)?.where))
  }
  if (CREATE_OPERATIONS.has(operation)) {
    const data =
      operation === 'upsert'
        ? (args as { create?: unknown } | undefined)?.create
        : (args as { data?: unknown } | undefined)?.data
    constraints.push(readCreateClinicConstraint(data))
  }
  if (constraints.length === 0) return

  const allowed = new Set(getAllowedClinicIds(ctx))
  let failure: TenantScopeError['code'] | null = null
  for (const c of constraints) {
    if (c === 'none' || c === 'invalid') {
      failure = 'tenant_scope_required'
      break
    }
    if (!ctx || c.some((id) => !allowed.has(id))) {
      failure = ctx ? 'tenant_scope_mismatch' : 'tenant_scope_required'
      break
    }
  }
  if (!failure) return

  const message = `[tenant-guard:${mode === 'warn' ? 'WARN' : 'VIOLATION'}] ${failure} ${describeViolation(model, operation, args)}`
  console.warn(message)
  if (mode === 'enforce') throw new TenantScopeError(failure, model, operation)
}

/**
 * Soft-vs-hard delete policy (B0.6.7). PHI and money records are never
 * hard-deleted by application code: they are cancelled, finalized or
 * soft-deleted (`PatientFile.isDeleted`). Hard deletion is reserved for the
 * data-lifecycle service (customer off-boarding, retention expiry), which
 * runs inside a `withTenantBypass('lifecycle:…')` scope.
 */
export const HARD_DELETE_PROTECTED_MODELS = new Set([
  'AIScribeSession',
  'Appointment',
  'AppointmentSeries',
  'AuditLog',
  'BreakGlassGrant',
  'Clinic',
  'CommissionRecord',
  'ConsultationSession',
  'FormResponse',
  'Invoice',
  'PatientFile',
  'PatientPackage',
  'PatientSubscription',
  'Payment',
  'Prescription',
  'SiteLead',
  'Tenant',
  'TreatmentPlan',
  'User',
  'VisitNoteVersion',
  'VisitRecord',
  'VoiceCall',
  'VoiceCallEvent',
])

export class HardDeleteForbiddenError extends Error {
  statusCode = 409
  code = 'hard_delete_forbidden'
  constructor(model: string) {
    super(`${model} records are retained: cancel or soft-delete instead of deleting`)
    this.name = 'HardDeleteForbiddenError'
  }
}

export function assertDeletePolicy(
  model: string,
  operation: string,
  ctx: TenantContext | undefined,
  mode = getIsolationMode()
): void {
  if (mode === 'off') return
  if (operation !== 'delete' && operation !== 'deleteMany') return
  if (!HARD_DELETE_PROTECTED_MODELS.has(model)) return
  if (ctx?.bypassReason?.startsWith('lifecycle:')) return
  console.warn(`[delete-policy:VIOLATION] ${model}.${operation} outside a lifecycle scope`)
  throw new HardDeleteForbiddenError(model)
}

/**
 * Postgres row-level security (B0.1.3). When TENANT_RLS is on (the default),
 * every query outside an explicit transaction runs as
 *   BEGIN; SELECT set_config(...); <query>; COMMIT
 * so the policies in migration 20261013010000_tenant_rls_v2 see the caller's
 * clinics. Interactive and batch transactions set the variables once, as
 * their first statement (see the `$transaction` proxy below).
 *
 * RLS only engages when the app connects as a role that is neither a
 * superuser nor BYPASSRLS — `assertDatabaseRoleEnforcesRls()` checks that at
 * boot.
 */
export function isRlsEnabled(): boolean {
  return (process.env.TENANT_RLS ?? 'on').toLowerCase() !== 'off'
}

function rlsSettings(ctx: TenantContext | undefined): [string, string, string] {
  return [getAllowedClinicIds(ctx).join(','), ctx?.bypassReason ? 'on' : 'off', ctx?.tenantId ?? '']
}

function setRlsConfig(client: { $executeRaw: PrismaClient['$executeRaw'] }) {
  const [clinicIds, bypass, tenantId] = rlsSettings(getTenantContext())
  return client.$executeRaw`SELECT set_config('app.clinic_ids', ${clinicIds}, TRUE), set_config('app.rls_bypass', ${bypass}, TRUE), set_config('app.current_tenant_id', ${tenantId}, TRUE)`
}

type OperationListener = (model: string, operation: string) => void
const operationListeners: OperationListener[] = []

/**
 * Observe every model operation the app issues (model + operation name only,
 * never arguments). Used by tests that bound how many queries an endpoint
 * makes (B1.3). Returns an unsubscribe function.
 */
export function onPrismaOperation(listener: OperationListener): () => void {
  operationListeners.push(listener)
  return () => {
    const i = operationListeners.indexOf(listener)
    if (i >= 0) operationListeners.splice(i, 1)
  }
}

const extended = basePrisma.$extends({
  name: 'tenantScopeGuard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query, ...rest }) {
        for (const listener of operationListeners) listener(model, operation)
        const ctx = getTenantContext()
        assertTenantScope(model, operation, args, ctx)
        assertDeletePolicy(model, operation, ctx)
        // B3.2: clinical text is sealed on the way in and opened on the way out.
        assertNoEncryptedFilter(model, args)
        const sealedArgs = sealWriteArgs(model, operation, args) as typeof args

        // Inside $transaction (interactive or batch) the variables were set
        // by the transaction's first statement.
        const inTransaction = (rest as { __internalParams?: { transaction?: unknown } })
          .__internalParams?.transaction
        if (!isRlsEnabled() || inTransaction) return openResult(await query(sealedArgs))

        const [, result] = await basePrisma.$transaction([
          setRlsConfig(basePrisma),
          query(sealedArgs),
        ])
        return openResult(result)
      },
    },
  },
})

/**
 * Maintenance only (B3.2 backfill / key rotation): rows exactly as stored —
 * encrypted fields stay sealed. Goes around the query extension, so it is
 * restricted to an explicit tenant-bypass scope; RLS variables are still set.
 */
export async function findManyAsStored(delegate: string, args: unknown): Promise<unknown[]> {
  if (!getTenantContext()?.bypassReason) {
    throw new Error('findManyAsStored requires a withTenantBypass scope')
  }
  const d = (
    basePrisma as unknown as Record<
      string,
      { findMany: (a: unknown) => ReturnType<PrismaClient['user']['findMany']> }
    >
  )[delegate]
  if (!d) throw new Error(`Unknown Prisma delegate "${delegate}"`)
  if (!isRlsEnabled()) return d.findMany(args)
  const [, rows] = await basePrisma.$transaction([setRlsConfig(basePrisma), d.findMany(args)])
  return rows
}

type ExtendedClient = typeof extended
/** The client an interactive `prisma.$transaction(async (tx) => …)` callback receives. */
export type TxClient = Parameters<Parameters<ExtendedClient['$transaction']>[0]>[0]

/**
 * `$transaction` that sets the RLS variables as the first statement of every
 * interactive or batch transaction. All other properties pass straight
 * through to the extended client.
 */
const prisma = new Proxy(extended, {
  get(target, prop, receiver) {
    if (prop !== '$transaction' || !isRlsEnabled())
      return Reflect.get(target, prop, receiver) as unknown
    return (arg: unknown, options?: unknown) => {
      if (typeof arg === 'function') {
        const fn = arg as (tx: TxClient) => Promise<unknown>
        return target.$transaction(async (tx) => {
          await setRlsConfig(tx)
          return fn(tx)
        }, options as never)
      }
      const batch = arg as Parameters<ExtendedClient['$transaction']>[0]
      return target
        .$transaction(
          [setRlsConfig(target), ...(batch as unknown as unknown[])] as never,
          options as never
        )
        .then((results: unknown[]) => results.slice(1))
    }
  },
})

/**
 * Boot check for B0.1.3: RLS is only live when the connection role is
 * neither a superuser nor BYPASSRLS. Returns the role facts so the caller
 * can decide (production: fatal; elsewhere: warn).
 */
export async function getDatabaseRoleInfo(): Promise<{
  role: string
  superuser: boolean
  bypassRls: boolean
}> {
  const rows = await basePrisma.$queryRaw<
    { role: string; superuser: boolean; bypassrls: boolean }[]
  >`SELECT current_user AS role, rolsuper AS superuser, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user`
  const r = rows[0]
  return { role: r?.role ?? 'unknown', superuser: !!r?.superuser, bypassRls: !!r?.bypassrls }
}

export default prisma
export type AppPrisma = typeof prisma

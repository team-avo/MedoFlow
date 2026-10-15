/**
 * Request-scoped tenant context, carried through async boundaries via
 * AsyncLocalStorage. Populated by `protect` / `optionalProtect` (or the
 * Express middleware `bindTenantContext`) and consumed by the Prisma client
 * extension in `config/prisma.ts`, which:
 *
 *  1. asserts that every query on a clinic-scoped model names a clinicId that
 *     belongs to the caller (`allowedClinicIds`) — B0.1.2, and
 *  2. forwards the same scope to Postgres row-level security as session
 *     variables (`app.clinic_ids`, `app.rls_bypass`) — B0.1.3.
 *
 * Design notes:
 *  - The context is OPT-IN at the request level. If a request never runs
 *    through `protect`/`withPublicScope` (e.g. a background job), Prisma
 *    queries against clinic-scoped models fail in enforce mode. That's
 *    intentional — background jobs MUST call `withTenantBypass(reason, fn)`
 *    or `withTenantContext(ctx, fn)` to declare their scope explicitly.
 *  - Bypass is a named escape hatch, not a silent flag. Every bypass
 *    carries a reason string so a future audit can grep for them.
 *  - We carry `userId` too for audit correlation only — the bypass logic
 *    does not consult it.
 */

import { AsyncLocalStorage } from 'async_hooks'

export interface TenantContext {
  /** The caller's primary clinic (staff: their clinic; patient: home clinic). */
  clinicId: string | null
  tenantId: string | null
  userId: string | null
  role: string | null
  /**
   * Every clinic the caller may read or write. Staff: exactly their clinic.
   * Patients: their home clinic plus every clinic they hold a
   * PatientClinicMembership with. Defaults to `[clinicId]` when omitted.
   */
  allowedClinicIds?: string[]
  /**
   * Non-null => query extension skips the clinicId assertion and Postgres
   * RLS is told to allow cross-clinic access. The value is the human-readable
   * reason for the bypass, logged for audit.
   */
  bypassReason: string | null
}

const storage = new AsyncLocalStorage<TenantContext>()

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore()
}

/**
 * Runs `fn` inside `ctx`. If `fn` returns a thenable — notably a lazy
 * PrismaPromise, which only executes when `.then` is called — it is started
 * *inside* the scope, so `withTenantBypass('x', () => prisma.a.findFirst(…))`
 * behaves the same as the `async () => await …` form.
 */
function runInScope<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, () => {
    const result = fn()
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      const thenable = result as unknown as PromiseLike<unknown>
      return new Promise((resolve, reject) => {
        void thenable.then(resolve, reject)
      }) as unknown as T
    }
    return result
  })
}

export function withTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return runInScope(ctx, fn)
}

/** The clinics the current context may touch. Empty when there is no context. */
export function getAllowedClinicIds(ctx: TenantContext | undefined = getTenantContext()): string[] {
  if (!ctx) return []
  if (ctx.allowedClinicIds) return ctx.allowedClinicIds
  return ctx.clinicId ? [ctx.clinicId] : []
}

/**
 * Run a function with the current tenant scope bypassed. Every call site
 * MUST pass a descriptive reason — these are logged and reviewed.
 *
 * Legitimate uses:
 *  - auth flows before a user is authenticated (login, signup, refresh)
 *  - platform-admin cross-tenant operations
 *  - signup that creates the first tenant/clinic/user (no context yet)
 *  - public webhooks (stripe) — use the embedded tenantId from metadata
 *  - background jobs (cron sweeps, queue workers)
 *
 * Misuse note: do NOT wrap a handler in `withTenantBypass` just to make
 * a failing query stop failing. The failure means the query is missing a
 * clinicId filter — fix the query, don't bypass the guard.
 */
export function withTenantBypass<T>(reason: string, fn: () => T): T {
  const prev = storage.getStore()
  const next: TenantContext = {
    clinicId: prev?.clinicId ?? null,
    tenantId: prev?.tenantId ?? null,
    userId: prev?.userId ?? null,
    role: prev?.role ?? null,
    allowedClinicIds: prev ? getAllowedClinicIds(prev) : [],
    bypassReason: reason,
  }
  return runInScope(next, fn)
}

/**
 * The `where` fragment that scopes a query on a clinic-scoped model to the
 * caller. Spread it into the where clause:
 *
 *   prisma.appointment.findFirst({ where: { id, ...clinicScope() } })
 *
 *  - staff:        `{ clinicId: '<their clinic>' }`
 *  - patient:      `{ clinicId: { in: [<home + member clinics>] } }`
 *  - bypass scope: `{}` (cross-clinic by design; the bypass reason is the audit trail)
 *  - no context:   `{ clinicId: { in: [] } }` — matches nothing (fail closed)
 */
export function clinicScope(): { clinicId?: string | { in: string[] } } {
  const ctx = getTenantContext()
  if (ctx?.bypassReason) return {}
  const ids = getAllowedClinicIds(ctx)
  if (ids.length === 1) return { clinicId: ids[0]! }
  return { clinicId: { in: ids } }
}

/**
 * Isolation modes:
 *  - off      — extension inactive.
 *  - warn     — violations are logged with model/operation/where-keys, but
 *               the query still runs. Useful while fixing flagged queries.
 *  - enforce  — violations throw. Any query on a clinic-scoped model that
 *               doesn't name one of the caller's clinics, and has no active
 *               bypass, is rejected before it reaches Postgres.
 *
 * Default is `enforce`. Production refuses to boot in any other mode
 * (see `config/envValidation.ts`).
 */
export type IsolationMode = 'off' | 'warn' | 'enforce'

export function getIsolationMode(): IsolationMode {
  const raw = (process.env.TENANT_ISOLATION_MODE ?? 'enforce').toLowerCase()
  if (raw === 'off' || raw === 'warn' || raw === 'enforce') return raw
  return 'enforce'
}

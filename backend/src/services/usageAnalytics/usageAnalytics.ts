/**
 * CTO-39: cross-clinic feature-usage events, sent server-side to PostHog.
 *
 * Privacy contract (HIPAA checklist §1.2, no BAA, `USAGE_ANALYTICS_POLICY=no-phi`):
 *  - One event name, `feature_used`. Its properties are an allow-list
 *    (`USAGE_PROPERTY_KEYS`) and every value must pass a strict validator:
 *    catalog keys, enum literals, record ids, small integers or booleans.
 *    Anything else is dropped before it leaves the process.
 *  - No names, emails, phone numbers, dates of birth, free text, URLs or
 *    clinical content, ever. Audit `oldValue` / `newValue` are never read.
 *  - Staff are identified by an HMAC of their user id (`USAGE_ANALYTICS_SALT`),
 *    so PostHog never holds a MedoFlow user id. Patients are never identified
 *    individually: their actions count under one id per clinic. An actor whose
 *    role is unknown counts under the clinic's "system" id.
 *  - Fire and forget: tracking never throws, never awaits the network on the
 *    request path, and is a no-op when PostHog is not configured.
 */

import crypto from 'crypto'
import { PostHog } from 'posthog-node'
import prisma from '../../config/prisma'
import { getTenantContext, withTenantBypass } from '../../config/tenantContext'
import {
  USAGE_AREAS,
  featureForAuditAction,
  getUsageFeature,
  type UsageFeature,
  type UsageFeatureKey,
} from '../../config/usageFeatures'
import { usageAnalyticsConfig, usageEnvName } from './config'

export const USAGE_EVENT = 'feature_used'

/** Every property a usage event may carry. Tested: nothing else ever leaves. */
export const USAGE_PROPERTY_KEYS = [
  'feature',
  'area',
  'role',
  'clinic_id',
  'tenant_id',
  'plan',
  'env',
  'source',
  'mode',
  'outcome',
  'count',
  'sent_to_patient',
] as const
export type UsagePropertyKey = (typeof USAGE_PROPERTY_KEYS)[number]

/** The properties a call site may add. Everything else is derived here. */
export interface UsageExtra {
  source?: string
  mode?: string
  outcome?: string
  count?: number
  sent_to_patient?: boolean
}

/** Who did it. Defaults to the request's tenant context. */
export interface UsageActor {
  clinicId?: string | null
  userId?: string | null
  role?: string | null
  tenantId?: string | null
}

export const USAGE_ROLES = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'PROVIDER',
  'FRONT_DESK',
  'ACCOUNTING',
  'MARKETING',
  'PATIENT',
  'STAFF',
  'SYSTEM',
] as const

export const USAGE_SOURCES = [
  // BookingSource (appointment.created)
  'PUBLIC',
  'PATIENT_PORTAL',
  'FRONT_DESK',
  'PROVIDER',
  'WAITLIST',
  'WALK_IN',
  'PHONE',
  'VOICE_AGENT',
  // Where a scribe session was started (CTO-30)
  'consult_room',
  'command_center',
  'appointments_list',
  'calendar',
  'reminder',
] as const

export const USAGE_MODES = ['IN_PERSON', 'VIRTUAL'] as const

export const USAGE_OUTCOMES = [
  'granted',
  'declined',
  'attested',
  'attested_verbal',
  'verified',
  'mismatch',
  'not_found',
  'unavailable',
] as const

const PLANS = ['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'] as const

const STAFF_ROLES = new Set<string>(USAGE_ROLES.filter((r) => r !== 'PATIENT' && r !== 'SYSTEM'))

/** Record ids are cuid / uuid / seeded `clinic_ab12cd34` style: lower case with a digit. */
const isRecordId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9_-]{8,64}$/.test(v) && /\d/.test(v)

const oneOf =
  (list: readonly string[]) =>
  (v: unknown): v is string =>
    typeof v === 'string' && list.includes(v)

const VALIDATORS: Record<UsagePropertyKey, (v: unknown) => boolean> = {
  feature: (v) => typeof v === 'string' && !!getUsageFeature(v),
  area: oneOf(USAGE_AREAS),
  role: oneOf(USAGE_ROLES),
  clinic_id: isRecordId,
  tenant_id: isRecordId,
  plan: oneOf(PLANS),
  env: (v) => typeof v === 'string' && /^[a-z0-9-]{1,20}$/.test(v),
  source: oneOf(USAGE_SOURCES),
  mode: oneOf(USAGE_MODES),
  outcome: oneOf(USAGE_OUTCOMES),
  count: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000,
  sent_to_patient: (v) => typeof v === 'boolean',
}

/**
 * Keeps only allow-listed keys whose values pass their validator. Returns the
 * clean properties and the names (never the values) of anything dropped.
 */
export const sanitizeUsageProperties = (
  raw: Record<string, unknown>
): { properties: Partial<Record<UsagePropertyKey, unknown>>; dropped: string[] } => {
  const properties: Partial<Record<UsagePropertyKey, unknown>> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue
    const validate = (VALIDATORS as Record<string, ((v: unknown) => boolean) | undefined>)[key]
    if (validate && validate(value)) properties[key as UsagePropertyKey] = value
    else dropped.push(key)
  }
  return { properties, dropped }
}

// ─── Client ──────────────────────────────────────────────────────────────────

/** The slice of posthog-node used here (tests inject a fake). */
export interface UsageClient {
  capture(msg: {
    distinctId: string
    event: string
    properties: Record<string, unknown>
    groups?: Record<string, string>
    disableGeoip?: boolean
  }): void
  groupIdentify(msg: {
    groupType: string
    groupKey: string
    properties: Record<string, unknown>
    distinctId?: string
    disableGeoip?: boolean
  }): void
  shutdown(timeoutMs?: number): Promise<void>
}

interface ClientState {
  client: UsageClient
  salt: string
  env: string
}

let state: ClientState | null | undefined

const getState = (): ClientState | null => {
  if (state !== undefined) return state
  const cfg = usageAnalyticsConfig()
  if (!cfg) {
    state = null
    return state
  }
  const ph = new PostHog(cfg.apiKey, {
    host: cfg.host,
    flushAt: 20,
    flushInterval: 10_000,
    requestTimeout: 10_000,
    disableGeoip: true,
    // No feature flags, surveys, remote config or exception capture: this
    // client only sends usage events.
    disableRemoteConfig: true,
    disableSurveys: true,
  })
  ph.on('error', (err: unknown) => {
    console.warn('[usage-analytics] send failed:', err instanceof Error ? err.name : 'error')
  })
  state = { client: ph as unknown as UsageClient, salt: cfg.salt, env: cfg.env }
  return state
}

export const isUsageAnalyticsEnabled = (): boolean => getState() !== null

/** Flushes queued events on graceful shutdown. */
export const shutdownUsageAnalytics = async (): Promise<void> => {
  const s = state
  if (!s) return
  try {
    await s.client.shutdown(5_000)
  } catch {
    /* shutting down anyway */
  }
}

const pending = new Set<Promise<void>>()

/** Test hook: inject a fake client (or null to turn tracking off). */
export const __setUsageClientForTests = (
  client: UsageClient | null,
  opts: { salt?: string; env?: string } = {}
): void => {
  state = client
    ? { client, salt: opts.salt ?? 'test-salt-test-salt-test-salt-0000', env: opts.env ?? 'test' }
    : null
  clinicCache.clear()
}

/** Test hook: wait for in-flight enrich-and-send work. */
export const __drainUsageForTests = async (): Promise<void> => {
  while (pending.size) await Promise.all([...pending])
}

// ─── Identity and enrichment ─────────────────────────────────────────────────

export const hashUserId = (userId: string, salt: string): string =>
  'u_' + crypto.createHmac('sha256', salt).update(userId).digest('hex').slice(0, 32)

/** PostHog distinct id: hashed staff user, or a per-clinic aggregate. Never a raw id. */
export const usageDistinctId = (
  actor: { role: string; userId: string | null; clinicId: string | null },
  salt: string
): string => {
  if (STAFF_ROLES.has(actor.role) && actor.userId) return hashUserId(actor.userId, salt)
  const bucket = actor.role === 'PATIENT' ? 'patients' : 'system'
  return actor.clinicId ? `clinic_${actor.clinicId}_${bucket}` : `platform_${bucket}`
}

interface ClinicFacts {
  tenantId: string
  plan: string
}
const CLINIC_CACHE_MS = 5 * 60 * 1000
const clinicCache = new Map<string, { facts: ClinicFacts | null; expires: number }>()

const clinicFacts = async (clinicId: string): Promise<ClinicFacts | null> => {
  const hit = clinicCache.get(clinicId)
  if (hit && hit.expires > Date.now()) return hit.facts
  const row = await withTenantBypass('usage-analytics:clinic-plan', () =>
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { tenantId: true, tenant: { select: { plan: true } } },
    })
  )
  const facts = row ? { tenantId: row.tenantId, plan: row.tenant.plan } : null
  clinicCache.set(clinicId, { facts, expires: Date.now() + CLINIC_CACHE_MS })
  return facts
}

const resolveActor = (actor?: UsageActor) => {
  const ctx = getTenantContext()
  const clinicId = actor?.clinicId !== undefined ? actor.clinicId : (ctx?.clinicId ?? null)
  const userId = actor?.userId !== undefined ? actor.userId : (ctx?.userId ?? null)
  const role = actor?.role !== undefined ? actor.role : (ctx?.role ?? null)
  const tenantId = actor?.tenantId !== undefined ? actor.tenantId : (ctx?.tenantId ?? null)
  const knownRole = role && (USAGE_ROLES as readonly string[]).includes(role) ? role : 'SYSTEM'
  return { clinicId, userId, role: knownRole, tenantId }
}

const send = async (
  s: ClientState,
  feature: UsageFeature,
  actor: ReturnType<typeof resolveActor>,
  extra: UsageExtra
): Promise<void> => {
  let tenantId = actor.tenantId
  let plan: string | undefined
  if (actor.clinicId) {
    try {
      const facts = await clinicFacts(actor.clinicId)
      if (facts) {
        tenantId = tenantId ?? facts.tenantId
        plan = facts.plan
      }
    } catch {
      /* enrichment is best effort */
    }
  }

  const { properties, dropped } = sanitizeUsageProperties({
    ...extra,
    feature: feature.key,
    area: feature.area,
    role: actor.role,
    clinic_id: actor.clinicId,
    tenant_id: tenantId,
    plan,
    env: s.env,
  })
  if (dropped.length) {
    console.warn(`[usage-analytics] ${feature.key}: dropped properties ${dropped.join(', ')}`)
  }

  s.client.capture({
    distinctId: usageDistinctId(actor, s.salt),
    event: USAGE_EVENT,
    properties,
    ...(actor.clinicId ? { groups: { clinic: actor.clinicId } } : {}),
    disableGeoip: true,
  })
}

const dispatch = (feature: UsageFeature, extra: UsageExtra, actor?: UsageActor): void => {
  try {
    const s = getState()
    if (!s) return
    const resolved = resolveActor(actor)
    const p = send(s, feature, resolved, extra)
      .catch(() => {
        console.warn(`[usage-analytics] ${feature.key}: not sent`)
      })
      .finally(() => pending.delete(p))
    pending.add(p)
  } catch {
    /* tracking never breaks the caller */
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Count one use of `feature`. Call after the action has succeeded (and committed). */
export const trackUsage = (
  feature: UsageFeatureKey,
  extra: UsageExtra = {},
  actor?: UsageActor
): void => {
  const f = getUsageFeature(feature)
  if (f) dispatch(f, extra, actor)
}

const CONSENT_OUTCOMES: Record<string, string> = {
  CONSENT_GRANTED: 'granted',
  CONSENT_DECLINED: 'declined',
  CONSENT_ATTESTED: 'attested',
  CONSENT_ATTESTED_VERBAL: 'attested_verbal',
}

/**
 * Called by `logAudit` after each audit row. Reads only the action, entity
 * type, clinic and actor id; a row counts only when the catalog maps it.
 */
export const trackAuditAction = (params: {
  action: string
  entityType: string
  clinicId: string | null
  performedById: string | null
}): void => {
  try {
    const feature = featureForAuditAction(params.action, params.entityType)
    if (!feature) return
    const ctx = getTenantContext()
    // The ambient role belongs to the actor only when it is the same user.
    const sameUser = !!ctx?.userId && ctx.userId === params.performedById
    const extra: UsageExtra = {}
    const outcome = CONSENT_OUTCOMES[params.action]
    if (outcome) extra.outcome = outcome
    dispatch(feature, extra, {
      clinicId: params.clinicId,
      userId: params.performedById,
      role: sameUser ? (ctx?.role ?? null) : 'SYSTEM',
      tenantId: sameUser ? (ctx?.tenantId ?? null) : null,
    })
  } catch {
    /* tracking never breaks the audit write */
  }
}

// ─── Clinic groups ───────────────────────────────────────────────────────────

/**
 * Refreshes the PostHog `clinic` group properties for every clinic. Business
 * facts only (plan, status, set-up progress); no patient or staff data.
 * Runs daily from cron. Returns the number of clinics sent.
 */
export const syncClinicGroups = async (): Promise<number> => {
  const s = getState()
  if (!s) return 0
  const clinics = await withTenantBypass('cron:usage-group-sync', () =>
    prisma.clinic.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        isActive: true,
        tenant: {
          select: {
            id: true,
            plan: true,
            status: true,
            verificationStatus: true,
            onboardingCompletedAt: true,
          },
        },
        site: { select: { publishedAt: true } },
        _count: { select: { providers: true } },
      },
    })
  )
  for (const c of clinics) {
    s.client.groupIdentify({
      groupType: 'clinic',
      groupKey: c.id,
      distinctId: `clinic_${c.id}_system`,
      disableGeoip: true,
      properties: {
        name: c.name,
        tenant_id: c.tenant.id,
        plan: c.tenant.plan,
        status: c.tenant.status,
        verification: c.tenant.verificationStatus,
        active: c.isActive,
        onboarding_completed: !!c.tenant.onboardingCompletedAt,
        has_published_site: !!c.site?.publishedAt,
        provider_count: c._count.providers,
        created_at: c.createdAt.toISOString(),
        env: s.env,
      },
    })
  }
  return clinics.length
}

/** The env tag the read side filters on (same rule as the emitter). */
export const currentUsageEnv = (): string => state?.env ?? usageEnvName()

/**
 * CTO-39: usage analytics. The payload allow-list (AC1: no PHI), identity
 * hashing, the audit hook, the catalog, boot checks and the read side.
 */
import fs from 'fs'
import path from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  clinic: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}))
vi.mock('../config/prisma', () => ({ default: db }))

import {
  USAGE_EVENT,
  USAGE_PROPERTY_KEYS,
  __drainUsageForTests,
  __setUsageClientForTests,
  hashUserId,
  sanitizeUsageProperties,
  syncClinicGroups,
  trackAuditAction,
  trackUsage,
  type UsageClient,
} from '../services/usageAnalytics/usageAnalytics'
import {
  usageAnalyticsConfig,
  usageAnalyticsConfigProblems,
  usageQueryConfig,
} from '../services/usageAnalytics/config'
import {
  __clearUsageQueryCache,
  csvCell,
  exportUsageCsv,
  getUsageSummary,
  parseUsageRange,
} from '../services/usageAnalytics/usageQueryService'
import {
  USAGE_AREAS,
  USAGE_FEATURES,
  featureForAuditAction,
  type UsageFeature,
} from '../config/usageFeatures'
import { logAudit } from '../services/auditService'
import { withTenantContext } from '../config/tenantContext'

const SALT = 'unit-test-salt-unit-test-salt-0123456789'
const CLINIC = 'clinic_ab12cd34'
const TENANT = 'cm0tenant0000000000000001'
const STAFF_USER = 'cm0user000000000000000001'
const PATIENT_USER = 'cm0patient00000000000001'

/** Synthetic PHI that must never appear in anything sent to PostHog. */
const PHI = {
  name: 'Jane Q Testpatient',
  email: 'jane.testpatient@example.com',
  phone: '+1 555 0100 4242',
  dob: '1980-02-29',
  note: 'chest pain radiating to left arm',
}

type Captured = Parameters<UsageClient['capture']>[0]

const fakeClient = () => {
  const captured: Captured[] = []
  const groups: Parameters<UsageClient['groupIdentify']>[0][] = []
  const client: UsageClient = {
    capture: vi.fn((m: Captured) => {
      captured.push(m)
    }),
    groupIdentify: vi.fn((m) => {
      groups.push(m)
    }),
    shutdown: vi.fn(async () => {}),
  }
  return { client, captured, groups }
}

const staffCtx = (role = 'SUPER_ADMIN', userId = STAFF_USER) => ({
  clinicId: CLINIC,
  tenantId: TENANT,
  userId,
  role,
  bypassReason: null,
})

beforeEach(() => {
  db.clinic.findUnique
    .mockReset()
    .mockResolvedValue({ tenantId: TENANT, tenant: { plan: 'GROWTH' } })
  db.clinic.findMany.mockReset()
  db.clinic.count.mockReset()
  db.auditLog.create.mockReset().mockResolvedValue({})
})

afterEach(() => {
  __setUsageClientForTests(null)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ─── AC1: payload allow-list, no PHI ─────────────────────────────────────────

describe('CTO-39 usage payload allow-list', () => {
  it('keeps only allow-listed keys whose values pass validation', () => {
    const { properties, dropped } = sanitizeUsageProperties({
      feature: 'scribe.approved',
      area: 'scribe',
      role: 'PROVIDER',
      clinic_id: CLINIC,
      source: 'WALK_IN',
      mode: 'VIRTUAL',
      count: 3,
      sent_to_patient: true,
      email: PHI.email,
      patientName: PHI.name,
    })
    expect(properties).toEqual({
      feature: 'scribe.approved',
      area: 'scribe',
      role: 'PROVIDER',
      clinic_id: CLINIC,
      source: 'WALK_IN',
      mode: 'VIRTUAL',
      count: 3,
      sent_to_patient: true,
    })
    expect(dropped.sort()).toEqual(['email', 'patientName'])
  })

  it('drops PHI smuggled into allow-listed keys', () => {
    const { properties, dropped } = sanitizeUsageProperties({
      source: PHI.email,
      outcome: PHI.name,
      mode: PHI.note,
      count: PHI.dob,
      clinic_id: PHI.name,
      tenant_id: 'Jane',
      feature: 'not.a.feature',
      env: 'Production Env!',
      sent_to_patient: 'yes',
    })
    expect(properties).toEqual({})
    expect(dropped).toHaveLength(9)
  })

  it('bounds counts to small non-negative integers', () => {
    expect(sanitizeUsageProperties({ count: -1 }).properties).toEqual({})
    expect(sanitizeUsageProperties({ count: 1.5 }).properties).toEqual({})
    expect(sanitizeUsageProperties({ count: 10_001 }).properties).toEqual({})
    expect(sanitizeUsageProperties({ count: 0 }).properties).toEqual({ count: 0 })
  })

  it('a captured event carries only allow-listed keys and no PHI', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT, env: 'demo' })
    withTenantContext(staffCtx(), () =>
      trackUsage('appointment.created', {
        source: 'PHONE',
        mode: 'IN_PERSON',
        // Deliberately wrong: a careless call site passing PHI.
        ...({ patientName: PHI.name, email: PHI.email } as object),
      })
    )
    await __drainUsageForTests()

    expect(captured).toHaveLength(1)
    const ev = captured[0]!
    expect(ev.event).toBe(USAGE_EVENT)
    for (const key of Object.keys(ev.properties)) {
      expect(USAGE_PROPERTY_KEYS as readonly string[]).toContain(key)
    }
    expect(ev.properties).toEqual({
      feature: 'appointment.created',
      area: 'scheduling',
      role: 'SUPER_ADMIN',
      clinic_id: CLINIC,
      tenant_id: TENANT,
      plan: 'GROWTH',
      env: 'demo',
      source: 'PHONE',
      mode: 'IN_PERSON',
    })
    expect(ev.groups).toEqual({ clinic: CLINIC })
    expect(ev.disableGeoip).toBe(true)
    const wire = JSON.stringify(captured)
    for (const v of Object.values(PHI)) expect(wire).not.toContain(v)
  })
})

// ─── Identity ────────────────────────────────────────────────────────────────

describe('CTO-39 usage identity', () => {
  it('staff are an HMAC of the user id, never the id itself', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    withTenantContext(staffCtx('PROVIDER'), () => trackUsage('scribe.approved'))
    await __drainUsageForTests()
    const id = captured[0]!.distinctId
    expect(id).toBe(hashUserId(STAFF_USER, SALT))
    expect(id).toMatch(/^u_[0-9a-f]{32}$/)
    expect(JSON.stringify(captured)).not.toContain(STAFF_USER)
    // A different salt gives a different id (the salt is the secret).
    expect(hashUserId(STAFF_USER, 'another-salt')).not.toBe(id)
  })

  it('patients are never identified individually', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    withTenantContext(staffCtx('PATIENT', PATIENT_USER), () => trackUsage('intake.submitted'))
    await __drainUsageForTests()
    expect(captured[0]!.distinctId).toBe(`clinic_${CLINIC}_patients`)
    expect(captured[0]!.properties.role).toBe('PATIENT')
    expect(JSON.stringify(captured)).not.toContain(PATIENT_USER)
  })

  it('an actor with no known role counts as the clinic system', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    trackUsage('payment.confirmed', {}, { clinicId: CLINIC, userId: PATIENT_USER, role: null })
    await __drainUsageForTests()
    expect(captured[0]!.distinctId).toBe(`clinic_${CLINIC}_system`)
    expect(captured[0]!.properties.role).toBe('SYSTEM')
  })
})

// ─── Safety: off by default, never throws ────────────────────────────────────

describe('CTO-39 usage tracking is safe', () => {
  it('is off without configuration (and always off under NODE_ENV=test)', () => {
    expect(
      usageAnalyticsConfig({
        NODE_ENV: 'test',
        POSTHOG_API_KEY: 'phc_x',
        USAGE_ANALYTICS_SALT: SALT,
      })
    ).toBeNull()
    expect(usageAnalyticsConfig({ NODE_ENV: 'development' })).toBeNull()
    expect(
      usageAnalyticsConfig({
        NODE_ENV: 'development',
        POSTHOG_API_KEY: 'phc_x',
        USAGE_ANALYTICS_SALT: 'short',
      })
    ).toBeNull()
    // Production also needs the no-PHI declaration.
    expect(
      usageAnalyticsConfig({
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_x',
        USAGE_ANALYTICS_SALT: SALT,
      })
    ).toBeNull()
    expect(
      usageAnalyticsConfig({
        NODE_ENV: 'production',
        POSTHOG_API_KEY: 'phc_x',
        USAGE_ANALYTICS_SALT: SALT,
        USAGE_ANALYTICS_POLICY: 'no-phi',
        USAGE_ANALYTICS_ENV: 'demo',
      })
    ).toMatchObject({ host: 'https://us.i.posthog.com', env: 'demo' })
  })

  it('does nothing when no client is configured', async () => {
    __setUsageClientForTests(null)
    expect(() => trackUsage('auth.login')).not.toThrow()
    await __drainUsageForTests()
    expect(db.clinic.findUnique).not.toHaveBeenCalled()
  })

  it('a failing client never breaks the audit write', async () => {
    const client: UsageClient = {
      capture: vi.fn(() => {
        throw new Error('network down')
      }),
      groupIdentify: vi.fn(),
      shutdown: vi.fn(async () => {}),
    }
    __setUsageClientForTests(client, { salt: SALT })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      logAudit({
        clinicId: CLINIC,
        entityType: 'VisitRecord',
        entityId: 'cm0visit0000000000000001',
        action: 'VISIT_FINALIZED',
        performedById: STAFF_USER,
      })
    ).resolves.toBeUndefined()
    await __drainUsageForTests()
    expect(db.auditLog.create).toHaveBeenCalledTimes(1)
    expect(client.capture).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a failing plan lookup still sends the event, without the plan', async () => {
    db.clinic.findUnique.mockRejectedValue(new Error('db down'))
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    withTenantContext(staffCtx(), () => trackUsage('product.created'))
    await __drainUsageForTests()
    expect(captured[0]!.properties.plan).toBeUndefined()
    expect(captured[0]!.properties.feature).toBe('product.created')
  })
})

// ─── Audit hook ──────────────────────────────────────────────────────────────

describe('CTO-39 audit actions → features', () => {
  it('a mapped audit action counts; READ and unmapped actions do not', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    await withTenantContext(staffCtx('PROVIDER'), async () => {
      for (const action of [
        'VISIT_FINALIZED',
        'READ',
        'BREAK_GLASS_ACCESS',
        'LOGIN_FAILURE',
        'UPDATE',
      ]) {
        await logAudit({
          clinicId: CLINIC,
          entityType: 'VisitRecord',
          entityId: 'cm0visit0000000000000001',
          action,
          // PHI in the audit values must never be read by the hook.
          oldValue: { patientName: PHI.name },
          newValue: { note: PHI.note, email: PHI.email },
          performedById: STAFF_USER,
        })
      }
    })
    await __drainUsageForTests()
    expect(captured.map((c) => c.properties.feature)).toEqual(['consult.visit_finalized'])
    expect(captured[0]!.properties.role).toBe('PROVIDER')
    const wire = JSON.stringify(captured)
    for (const v of Object.values(PHI)) expect(wire).not.toContain(v)
  })

  it('consent outcomes are carried as an enum', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    trackAuditAction({
      action: 'CONSENT_DECLINED',
      entityType: 'ConsultationSession',
      clinicId: CLINIC,
      performedById: null,
    })
    await __drainUsageForTests()
    expect(captured[0]!.properties).toMatchObject({
      feature: 'consult.consent',
      outcome: 'declined',
      role: 'SYSTEM',
    })
  })

  it('the ambient role is used only when the context user is the actor', async () => {
    const { client, captured } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT })
    withTenantContext(staffCtx('FRONT_DESK'), () =>
      trackAuditAction({
        action: 'CART_CHECKOUT',
        entityType: 'Cart',
        clinicId: CLINIC,
        performedById: 'cm0someoneelse0000000001',
      })
    )
    await __drainUsageForTests()
    expect(captured[0]!.properties.role).toBe('SYSTEM')
    expect(captured[0]!.distinctId).toBe(`clinic_${CLINIC}_system`)
  })
})

// ─── Catalog ─────────────────────────────────────────────────────────────────

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'tests' ? [] : walk(p)
    return p.endsWith('.ts') ? [p] : []
  })

describe('CTO-39 feature catalog', () => {
  const features = USAGE_FEATURES as readonly UsageFeature[]

  it('has unique keys and known areas', () => {
    const keys = features.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of features) {
      expect(USAGE_AREAS).toContain(f.area)
      expect(f.key).toMatch(/^[a-z_]+\.[a-z_]+$/)
      expect(f.label.length).toBeGreaterThan(3)
    }
  })

  it('every mapped audit action is written somewhere in the backend (no drift)', () => {
    const srcRoot = path.resolve(__dirname, '..')
    const catalogFile = path.join(srcRoot, 'config', 'usageFeatures.ts')
    const source = walk(srcRoot)
      .filter((f) => f !== catalogFile)
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n')
    for (const f of features) {
      for (const a of f.auditActions ?? []) {
        const action = a.split(':')[0]!
        expect(source.includes(`'${action}'`), `${a} (${f.key}) is not written anywhere`).toBe(true)
      }
    }
  })

  it('resolves ACTION and ACTION:EntityType, and ignores the rest', () => {
    expect(featureForAuditAction('AI_DRAFT_REGENERATED')?.key).toBe('scribe.draft_generated')
    expect(featureForAuditAction('SITE_PUBLISHED', 'Site')?.key).toBe('site.published')
    expect(featureForAuditAction('READ')).toBeUndefined()
    expect(featureForAuditAction('CREATE', 'Product')).toBeUndefined()
  })
})

// ─── Clinic groups ───────────────────────────────────────────────────────────

describe('CTO-39 clinic group sync', () => {
  it('sends business facts only', async () => {
    db.clinic.findMany.mockResolvedValue([
      {
        id: CLINIC,
        name: 'Sunrise Longevity',
        createdAt: new Date('2026-11-01T00:00:00Z'),
        isActive: true,
        tenant: {
          id: TENANT,
          plan: 'FREE',
          status: 'TRIAL',
          verificationStatus: 'APPROVED',
          onboardingCompletedAt: new Date(),
        },
        site: null,
        _count: { providers: 2 },
      },
    ])
    const { client, groups } = fakeClient()
    __setUsageClientForTests(client, { salt: SALT, env: 'demo' })
    await expect(syncClinicGroups()).resolves.toBe(1)
    expect(groups[0]).toMatchObject({ groupType: 'clinic', groupKey: CLINIC })
    expect(Object.keys(groups[0]!.properties).sort()).toEqual(
      [
        'active',
        'created_at',
        'env',
        'has_published_site',
        'name',
        'onboarding_completed',
        'plan',
        'provider_count',
        'status',
        'tenant_id',
        'verification',
      ].sort()
    )
  })

  it('is a no-op when analytics is off', async () => {
    await expect(syncClinicGroups()).resolves.toBe(0)
    expect(db.clinic.findMany).not.toHaveBeenCalled()
  })
})

// ─── Boot checks ─────────────────────────────────────────────────────────────

describe('CTO-39 usage analytics boot checks', () => {
  it('nothing set: one warning, nothing fatal', () => {
    const p = usageAnalyticsConfigProblems({ NODE_ENV: 'production' })
    expect(p).toHaveLength(1)
    expect(p[0]!.fatal).toBe(false)
  })

  it('a key without a strong salt is fatal', () => {
    const p = usageAnalyticsConfigProblems({
      POSTHOG_API_KEY: 'phc_x',
      USAGE_ANALYTICS_SALT: 'short',
    })
    expect(p.some((x) => x.fatal && /USAGE_ANALYTICS_SALT/.test(x.message))).toBe(true)
  })

  it('production must declare the no-PHI policy', () => {
    const base = { NODE_ENV: 'production', POSTHOG_API_KEY: 'phc_x', USAGE_ANALYTICS_SALT: SALT }
    expect(
      usageAnalyticsConfigProblems(base).some(
        (x) => x.fatal && /USAGE_ANALYTICS_POLICY/.test(x.message)
      )
    ).toBe(true)
    const ok = usageAnalyticsConfigProblems({
      ...base,
      USAGE_ANALYTICS_POLICY: 'no-phi',
      USAGE_ANALYTICS_ENV: 'production',
      POSTHOG_PROJECT_ID: '12345',
      POSTHOG_PERSONAL_API_KEY: 'phx_y',
    })
    expect(ok).toEqual([])
  })

  it('messages name variables, never values', () => {
    const secret = 'phc_SUPERSECRETVALUE'
    const p = usageAnalyticsConfigProblems({ POSTHOG_API_KEY: secret, NODE_ENV: 'production' })
    expect(JSON.stringify(p)).not.toContain(secret)
  })

  it('the read side needs a numeric project id and a personal key', () => {
    expect(usageQueryConfig({ POSTHOG_PROJECT_ID: '123' })).toBeNull()
    expect(
      usageQueryConfig({ POSTHOG_PROJECT_ID: 'abc', POSTHOG_PERSONAL_API_KEY: 'k' })
    ).toBeNull()
    expect(
      usageQueryConfig({
        POSTHOG_PROJECT_ID: '123',
        POSTHOG_PERSONAL_API_KEY: 'k',
        POSTHOG_APP_HOST: 'https://eu.posthog.com/',
      })
    ).toMatchObject({ appHost: 'https://eu.posthog.com', projectId: '123' })
  })
})

// ─── Read side ───────────────────────────────────────────────────────────────

describe('CTO-39 usage summary and export', () => {
  const OTHER = 'clinic_ff99ee88'
  const matrix = [
    [CLINIC, 'scribe.approved', 6, '2026-11-15T10:00:00Z'],
    [CLINIC, 'appointment.completed', 8, '2026-11-15T09:00:00Z'],
    [OTHER, 'appointment.completed', 4, '2026-11-14T09:00:00Z'],
    [OTHER, 'appointment.created', 5, '2026-11-14T08:00:00Z'],
    ['', 'clinic.approved', 1, '2026-11-13T08:00:00Z'],
    [CLINIC, 'retired.feature', 99, '2026-11-13T08:00:00Z'],
  ]
  const series = [
    ['appointment.completed', '2026-11-09', 12, 2],
    ['scribe.approved', '2026-11-09', 6, 1],
  ]

  const stubPostHog = (ok = true) => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      if (!ok) return new Response('nope', { status: 500 })
      const q = (JSON.parse(init.body) as { query: { query: string } }).query.query
      return new Response(
        JSON.stringify({ results: q.includes('toStartOfWeek') ? series : matrix }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    __clearUsageQueryCache()
    vi.stubEnv('POSTHOG_PROJECT_ID', '4242')
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_test')
    vi.stubEnv('USAGE_ANALYTICS_ENV', 'demo')
    db.clinic.count.mockResolvedValue(3)
  })

  it('is "not configured" without the read keys', async () => {
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', '')
    await expect(getUsageSummary(30)).resolves.toEqual({ configured: false })
  })

  it('lists every catalog feature, zero-use included, ranked by reach', async () => {
    const fetchMock = stubPostHog()
    const s = await getUsageSummary(30)
    if (!s.configured) throw new Error('expected configured')

    expect(s.features).toHaveLength(USAGE_FEATURES.length)
    expect(s.features[0]).toMatchObject({ key: 'appointment.completed', clinics: 2, events: 12 })
    const zero = s.features.find((f) => f.key === 'site.domain_added')!
    expect(zero).toMatchObject({ events: 0, clinics: 0, lastUsed: null })
    expect(s.features.some((f) => f.key === 'retired.feature')).toBe(false)
    expect(s.totals).toMatchObject({
      events: 6 + 8 + 4 + 5 + 1,
      activeClinics: 2,
      totalClinics: 3,
      featuresUsed: 4,
      scribeAdoption: 0.5,
    })
    expect(s.weeks).toEqual(['2026-11-09'])

    // The request: server-side, bearer key, HogQL, env- and range-filtered.
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://us.posthog.com/api/projects/4242/query/')
    expect((init as unknown as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer phx_test',
    })
    const q = (
      JSON.parse((init as { body: string }).body) as { query: { kind: string; query: string } }
    ).query
    expect(q.kind).toBe('HogQLQuery')
    expect(q.query).toContain("properties.env = 'demo'")
    expect(q.query).toContain('INTERVAL 30 DAY')

    // Cached: a second load makes no new calls.
    await getUsageSummary(30)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a PostHog failure is a clean 502', async () => {
    stubPostHog(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(getUsageSummary(7)).rejects.toMatchObject({
      statusCode: 502,
      code: 'usage_unavailable',
    })
    warn.mockRestore()
  })

  it('only fixed ranges reach the query', () => {
    expect(parseUsageRange('90')).toBe(90)
    expect(parseUsageRange('31')).toBe(30)
    expect(parseUsageRange('1; DROP TABLE events')).toBe(30)
    expect(parseUsageRange(undefined)).toBe(30)
  })

  it('exports clinic × feature rows as CSV with names from our database', async () => {
    stubPostHog()
    db.clinic.findMany.mockResolvedValue([
      { id: CLINIC, name: 'Sunrise, Longevity', tenant: { plan: 'GROWTH' } },
      { id: OTHER, name: '=HYPERLINK("x")', tenant: { plan: 'FREE' } },
    ])
    const csv = (await exportUsageCsv(30))!
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('clinic_id,clinic_name,plan,feature,feature_label,area,events,last_used')
    expect(lines).toHaveLength(1 + 4)
    expect(csv).toContain(`${CLINIC},"Sunrise, Longevity",GROWTH,scribe.approved`)
    // Formula injection is neutralised.
    expect(csv).toContain(`'=HYPERLINK(""x"")`)
    expect(csv).not.toContain('retired.feature')
  })

  it('csvCell quotes and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell(5)).toBe('5')
    expect(csvCell(null)).toBe('')
  })
})

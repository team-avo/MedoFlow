/**
 * CTO-39: cross-clinic feature-usage analytics, end to end through the API
 * with a fake PostHog client (nothing leaves the process).
 *
 *  - Real actions emit `feature_used` with allow-listed properties only:
 *    an owner's walk-in booking, a completion, a sign-in, an audited action.
 *  - Nothing sent carries the patient's name, email or phone, or any raw
 *    MedoFlow user id.
 *  - GET /platform/usage and /platform/usage/export.csv are platform-admin
 *    only, read PostHog server-side, list zero-use features, and the export
 *    is audited with ids only.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminDb, api, FIXTURE_PASSWORD, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import {
  USAGE_EVENT,
  USAGE_PROPERTY_KEYS,
  __drainUsageForTests,
  __setUsageClientForTests,
  type UsageClient,
} from '../../services/usageAnalytics/usageAnalytics'
import { __clearUsageQueryCache } from '../../services/usageAnalytics/usageQueryService'
import { USAGE_FEATURES } from '../../config/usageFeatures'

type Captured = Parameters<UsageClient['capture']>[0]

let server: TestServer
let fx: ClinicFixture
let owner: string
let platform: string
let platformUserId: string
const captured: Captured[] = []

const client: UsageClient = {
  capture: (m) => {
    captured.push(m)
  },
  groupIdentify: () => {},
  shutdown: async () => {},
}

beforeAll(async () => {
  server = await startServer()
  fx = await createClinicFixture('usage')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  const email = `platform.usage.${crypto.randomBytes(3).toString('hex')}@example.test`
  const u = await adminDb.user.create({
    data: {
      name: 'Platform Admin',
      email,
      role: 'PLATFORM_ADMIN',
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
    },
  })
  platformUserId = u.id
  platform = (await login(server.url, email)).accessToken
})
afterAll(async () => {
  __setUsageClientForTests(null)
  await server.close()
})

beforeEach(() => {
  captured.length = 0
  __setUsageClientForTests(client, { env: 'it' })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const events = async (feature?: string) => {
  await __drainUsageForTests()
  return captured.filter((c) => !feature || c.properties.feature === feature)
}

const expectAllowListed = (list: Captured[]) => {
  for (const c of list) {
    expect(c.event).toBe(USAGE_EVENT)
    for (const k of Object.keys(c.properties)) {
      expect(USAGE_PROPERTY_KEYS as readonly string[]).toContain(k)
    }
  }
}

describe('usage events from real actions', () => {
  it('an owner walk-in booking: appointment.created with WALK_IN, no PHI, no raw ids', async () => {
    const name = 'Usage Walkin Testpatient'
    const phone = '555-0177'
    const p = await api(server.url, '/patients', { token: owner, body: { name, phone } })
    expect(p.status, JSON.stringify(p.body)).toBe(201)
    const patientId = p.body.data.patient.id as string

    const start = new Date(Date.now() + 10 * 60_000)
    const res = await api(server.url, '/appointments', {
      token: owner,
      body: {
        providerId: fx.providerId,
        serviceId: fx.serviceId,
        locationId: fx.locationId,
        patientId,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
        bookingSource: 'WALK_IN',
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)

    const [ev, ...rest] = await events('appointment.created')
    expect(rest).toHaveLength(0)
    expect(ev!.properties).toMatchObject({
      feature: 'appointment.created',
      area: 'scheduling',
      role: 'SUPER_ADMIN',
      clinic_id: fx.clinicId,
      tenant_id: fx.tenantId,
      plan: 'FREE',
      env: 'it',
      source: 'WALK_IN',
      mode: 'IN_PERSON',
    })
    expect(ev!.groups).toEqual({ clinic: fx.clinicId })
    expect(ev!.distinctId).toMatch(/^u_[0-9a-f]{32}$/)

    // The audited PATIENT_CREATED counts too.
    expect(await events('patient.created')).toHaveLength(1)

    const all = await events()
    expectAllowListed(all)
    const wire = JSON.stringify(all)
    for (const secret of [name, phone, patientId, fx.users.admin.id, fx.users.admin.email]) {
      expect(wire).not.toContain(secret)
    }

    // Marking it completed counts towards scribe adoption's denominator.
    captured.length = 0
    const done = await api(server.url, `/appointments/${res.body.data.appointment.id}/status`, {
      token: owner,
      method: 'PUT',
      body: { status: 'COMPLETED' },
    })
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect(await events('appointment.completed')).toHaveLength(1)
  })

  it('a sign-in counts as auth.login with the role, staff hashed, patients per clinic', async () => {
    await login(server.url, fx.users.frontDesk.email)
    await login(server.url, fx.users.patient.email)
    const logins = await events('auth.login')
    expect(logins.map((l) => l.properties.role).sort()).toEqual(['FRONT_DESK', 'PATIENT'])
    const patientLogin = logins.find((l) => l.properties.role === 'PATIENT')!
    expect(patientLogin.distinctId).toBe(`clinic_${fx.clinicId}_patients`)
    const staffLogin = logins.find((l) => l.properties.role === 'FRONT_DESK')!
    expect(staffLogin.distinctId).toMatch(/^u_[0-9a-f]{32}$/)
    expect(JSON.stringify(logins)).not.toContain(fx.users.patient.id)
    expect(JSON.stringify(logins)).not.toContain(fx.users.frontDesk.id)
  })

  it('a failed sign-in is not usage', async () => {
    const res = await api(server.url, '/auth/login', {
      body: { email: fx.users.frontDesk.email, password: 'wrong-password-123' },
    })
    expect(res.status).toBe(401)
    expect(await events()).toHaveLength(0)
  })

  it('with analytics off, actions still succeed and nothing is sent', async () => {
    __setUsageClientForTests(null)
    await login(server.url, fx.users.frontDesk.email)
    expect(await events()).toHaveLength(0)
  })
})

describe('GET /platform/usage', () => {
  const realFetch = globalThis.fetch
  const stubPostHog = () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = input.toString()
      if (!url.startsWith('https://us.posthog.com/')) return realFetch(input, init)
      calls.push(url)
      const q = (JSON.parse(init?.body as string) as { query: { query: string } }).query.query
      const rows = q.includes('toStartOfWeek')
        ? [['appointment.created', '2026-11-09', 3, 1]]
        : [
            [fx.clinicId, 'appointment.created', 3, '2026-11-15T10:00:00Z'],
            [fx.clinicId, 'scribe.approved', 2, '2026-11-15T11:00:00Z'],
          ]
      return new Response(JSON.stringify({ results: rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    return calls
  }

  beforeEach(() => {
    __clearUsageQueryCache()
  })

  it('is platform-admin only', async () => {
    const res = await api(server.url, '/platform/usage', { token: owner })
    expect(res.status).toBe(403)
    const csv = await api(server.url, '/platform/usage/export.csv', { token: owner })
    expect(csv.status).toBe(403)
    const anon = await api(server.url, '/platform/usage')
    expect(anon.status).toBe(401)
  })

  it('answers "not configured" without the PostHog read keys', async () => {
    vi.stubEnv('POSTHOG_PROJECT_ID', '')
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', '')
    const res = await api(server.url, '/platform/usage', { token: platform })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ configured: false })
    const csv = await api(server.url, '/platform/usage/export.csv', { token: platform })
    expect(csv.status).toBe(404)
  })

  it('lists every catalog feature with reach, zero-use included', async () => {
    vi.stubEnv('POSTHOG_PROJECT_ID', '777')
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_it')
    vi.stubEnv('USAGE_ANALYTICS_ENV', 'it')
    const calls = stubPostHog()
    const res = await api(server.url, '/platform/usage?days=90', { token: platform })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const data = res.body.data
    expect(data).toMatchObject({ configured: true, env: 'it', days: 90 })
    expect(data.features).toHaveLength(USAGE_FEATURES.length)
    expect(data.features[0]).toMatchObject({ key: 'appointment.created', clinics: 1, events: 3 })
    const unused = data.features.filter((f: { events: number }) => f.events === 0)
    expect(unused.length).toBe(USAGE_FEATURES.length - 2)
    expect(data.totals).toMatchObject({ events: 5, activeClinics: 1, featuresUsed: 2 })
    expect(calls.every((u) => u === 'https://us.posthog.com/api/projects/777/query/')).toBe(true)
  })

  it('exports clinic × feature CSV, audited with ids only', async () => {
    vi.stubEnv('POSTHOG_PROJECT_ID', '777')
    vi.stubEnv('POSTHOG_PERSONAL_API_KEY', 'phx_it')
    vi.stubEnv('USAGE_ANALYTICS_ENV', 'it')
    stubPostHog()
    const res = await fetch(`${server.url}/platform/usage/export.csv?days=30`, {
      headers: { authorization: `Bearer ${platform}`, 'x-medoflow-client': 'web' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    expect(res.headers.get('content-disposition')).toMatch(/medoflow-feature-usage-30d-/)
    const text = await res.text()
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toBe('clinic_id,clinic_name,plan,feature,feature_label,area,events,last_used')
    expect(lines).toHaveLength(3)
    expect(text).toContain(`${fx.clinicId},Clinic usage-`)

    const audit = await adminDb.auditLog.findFirst({
      where: { action: 'USAGE_EXPORTED', performedById: platformUserId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).toMatchObject({ entityType: 'Platform', clinicId: null, newValue: { days: 30 } })
  })
})

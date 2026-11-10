/**
 * Demo feedback WS4 — new clinic sign-up with a plan, and the demo billing mode.
 *
 *  - GET /tenants/plans lists the plans, the billing mode and the trial length.
 *  - Sign-up stores the chosen plan; in `trial` mode the clinic is TRIAL for
 *    14 days, in `demo` mode it is ACTIVE with no end and every plan gets the
 *    top limits (nothing expires, nothing is gated).
 *  - Enterprise is sales-led; unknown plans are refused.
 *  - The new owner can sign in and lands in onboarding.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { SITE_ENTITLEMENTS } from '../../site/entitlements'

let server: TestServer
const saved = process.env.BILLING_MODE
beforeAll(async () => {
  server = await startServer()
})
afterEach(() => {
  if (saved === undefined) delete process.env.BILLING_MODE
  else process.env.BILLING_MODE = saved
})
afterAll(() => server.close())

const PASSWORD = 'Synthetic-Signup-Pass-2026!'
let n = 0
const signup = (plan?: string) => {
  const sub = `ws4${Date.now().toString(36)}${n++}`
  return {
    sub,
    res: api(server.url, '/tenants/signup', {
      body: {
        clinicName: `Synthetic WS4 Clinic ${sub}`,
        clinicEmail: `clinic.${sub}@example.test`,
        subdomain: sub,
        ownerName: 'Owner Synthetic',
        ownerEmail: `owner.${sub}@example.test`,
        password: PASSWORD,
        ...(plan ? { plan } : {}),
      },
    }),
  }
}

describe('plan catalogue', () => {
  it('lists four plans (Enterprise sales-led), the billing mode and the trial length', async () => {
    const res = await api(server.url, '/tenants/plans')
    expect(res.status).toBe(200)
    expect(res.body.data.billingMode).toBe('trial')
    expect(res.body.data.trialDays).toBe(14)
    const plans = res.body.data.plans as { key: string; selfServe: boolean; highlights: string[] }[]
    expect(plans.map((p) => p.key)).toEqual(['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'])
    expect(plans.filter((p) => !p.selfServe).map((p) => p.key)).toEqual(['ENTERPRISE'])
    expect(plans[0]!.highlights.join(' ')).toContain(`${SITE_ENTITLEMENTS.FREE.maxPages} pages`)
  })
})

describe('trial mode (default)', () => {
  it('signs up on the chosen plan with a 14-day trial, then the owner lands in onboarding', async () => {
    const { sub, res } = signup('GROWTH')
    const r = await res
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.data).toMatchObject({ plan: 'GROWTH', status: 'TRIAL' })
    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: r.body.data.tenantId } })
    expect(tenant.plan).toBe('GROWTH')
    const days = (tenant.trialEndsAt!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)

    const { accessToken } = await login(server.url, `owner.${sub}@example.test`, PASSWORD)
    const me = await api(server.url, '/auth/me', { token: accessToken })
    expect(me.body.data.user.role).toBe('SUPER_ADMIN')
    expect(me.body.data.user.clinic.tenant.onboardingCompletedAt).toBeNull()
  })

  it('no plan means Free; Enterprise and unknown plans are refused', async () => {
    const free = await signup().res
    expect(free.status).toBe(201)
    expect(free.body.data.plan).toBe('FREE')

    const enterprise = await signup('ENTERPRISE').res
    expect(enterprise.status).toBe(400)
    expect(JSON.stringify(enterprise.body)).toMatch(/contact sales/i)
    expect((await signup('PLATINUM').res).status).toBe(400)
  })
})

describe('demo mode (BILLING_MODE=demo)', () => {
  it('the plan is display-only: ACTIVE, no trial end, and Free gets the top limits', async () => {
    process.env.BILLING_MODE = 'demo'
    expect((await api(server.url, '/tenants/plans')).body.data.billingMode).toBe('demo')

    const { sub, res } = signup('FREE')
    const r = await res
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.data).toMatchObject({ plan: 'FREE', status: 'ACTIVE', trialEndsAt: null })

    const { accessToken } = await login(server.url, `owner.${sub}@example.test`, PASSWORD)
    const site = await api(server.url, '/site', { token: accessToken })
    expect(site.status, JSON.stringify(site.body)).toBe(200)
    expect(site.body.data.entitlements).toEqual(SITE_ENTITLEMENTS.ENTERPRISE)
  })
})

/**
 *  B0.5.3 authZ matrix: role × endpoint → expected allow / deny, so a
 *         permission regression fails CI.
 *  B0.1.4 public routes never return another clinic's rows.
 *  B0.6.2 security headers (helmet + HSTS) on every response.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
const tokens: Record<string, string> = {}

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('authz-a')
  B = await createClinicFixture('authz-b')
  for (const [role, user] of Object.entries(A.users)) {
    tokens[role] = (await login(server.url, user.email)).accessToken
  }
})
afterAll(() => server.close())

type Role = 'admin' | 'provider' | 'frontDesk' | 'patient'
const ALLOW = 'allow' as const
const DENY = 'deny' as const
type Expect = typeof ALLOW | typeof DENY

// Expected outcome per role. "allow" = 2xx; "deny" = 403.
const MATRIX: [string, Record<Role, Expect>][] = [
  ['/staff', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: DENY }],
  ['/roles', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: DENY }],
  ['/audit', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: DENY }],
  ['/commissions/rules', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: DENY }],
  ['/site-pages', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: DENY }],
  ['/invoices', { admin: ALLOW, provider: DENY, frontDesk: ALLOW, patient: DENY }],
  ['/appointments/clinic', { admin: ALLOW, provider: DENY, frontDesk: ALLOW, patient: DENY }],
  ['/forms/templates', { admin: ALLOW, provider: DENY, frontDesk: ALLOW, patient: DENY }],
  ['/appointments/provider', { admin: DENY, provider: ALLOW, frontDesk: DENY, patient: DENY }],
  ['/services', { admin: ALLOW, provider: ALLOW, frontDesk: ALLOW, patient: DENY }],
  ['/treatment-plans', { admin: ALLOW, provider: ALLOW, frontDesk: ALLOW, patient: DENY }],
  ['/voice-agent/config', { admin: ALLOW, provider: ALLOW, frontDesk: ALLOW, patient: DENY }],
  ['/voice-agent/calls', { admin: ALLOW, provider: ALLOW, frontDesk: ALLOW, patient: DENY }],
  ['/invoices/my', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: ALLOW }],
  ['/appointments/my', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: ALLOW }],
  ['/patients/packages', { admin: ALLOW, provider: DENY, frontDesk: DENY, patient: ALLOW }],
]

describe('authZ matrix', () => {
  for (const [path, expected] of MATRIX) {
    it(`${path}`, async () => {
      for (const role of Object.keys(expected) as Role[]) {
        const res = await api(server.url, path, { token: tokens[role] })
        const outcome =
          res.status >= 200 && res.status < 300
            ? ALLOW
            : res.status === 403
              ? DENY
              : `status ${res.status}`
        // SUPER_ADMIN has no Provider row → provider-only routes answer 404 for them.
        const adminProviderRoute =
          role === 'admin' && path === '/appointments/provider' && res.status === 404
        expect(adminProviderRoute ? DENY : outcome, `${role} ${path}`).toBe(expected[role])
      }
    })
  }

  it('every protected route rejects an anonymous caller with 401', async () => {
    for (const [path] of MATRIX) {
      expect((await api(server.url, path)).status, path).toBe(401)
    }
  })

  it('only clinic admins can change the voice-agent configuration', async () => {
    const res = await api(server.url, '/voice-agent/config', {
      method: 'PUT',
      token: tokens.frontDesk,
      body: {},
    })
    expect(res.status).toBe(403)
  })
})

describe('public routes stay inside the clinic named in the URL (B0.1.4)', () => {
  it('no public read for clinic A returns any clinic-B row', async () => {
    const paths = [
      `/public/clinics/${A.clinicId}`,
      `/public/clinics/${A.clinicId}/services`,
      `/public/clinics/${A.clinicId}/providers`,
      `/public/clinics/${A.clinicId}/locations`,
      `/public/clinics/${A.clinicId}/products`,
      `/public/clinics/${A.clinicId}/packages`,
      `/public/clinics/${A.clinicId}/memberships`,
      `/public/availability?clinicId=${A.clinicId}&serviceId=${A.serviceId}&providerId=${A.providerId}&date=${slot(5, 9).startTime.slice(0, 10)}`,
    ]
    const bIds = [B.clinicId, B.providerId, B.serviceId, B.locationId, B.users.patient.id]
    for (const p of paths) {
      const res = await api(server.url, p)
      expect(res.status, p).toBeLessThan(500)
      const body = JSON.stringify(res.body)
      for (const id of bIds) expect(body.includes(id), `${p} leaked ${id}`).toBe(false)
    }
  })

  it('availability mixing clinic A with a clinic-B provider/service returns nothing of B', async () => {
    const res = await api(
      server.url,
      `/public/availability?clinicId=${A.clinicId}&serviceId=${B.serviceId}&providerId=${B.providerId}&date=${slot(5, 9).startTime.slice(0, 10)}`
    )
    expect(res.status).toBeLessThan(500)
    expect(
      JSON.stringify(res.body).includes(B.providerId) &&
        res.status === 200 &&
        (res.body?.data?.slots?.length ?? 0) > 0
    ).toBe(false)
  })

  it('a slot hold for clinic A with a clinic-B provider is refused', async () => {
    const res = await api(server.url, '/public/slots/hold', {
      body: {
        clinicId: A.clinicId,
        providerId: B.providerId,
        serviceId: B.serviceId,
        timezone: 'UTC',
        ...slot(6, 10),
      },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it("releasing clinic B's hold while naming clinic A does nothing", async () => {
    const hold = await adminDb.slotHold.create({
      data: {
        clinicId: B.clinicId,
        providerId: B.providerId,
        serviceId: B.serviceId,
        startTime: new Date(slot(7, 10).startTime),
        endTime: new Date(slot(7, 10).endTime),
        expiresAt: new Date(Date.now() + 180_000),
        timezone: 'UTC',
      },
    })
    const res = await api(server.url, `/public/slots/hold/${hold.id}?clinicId=${A.clinicId}`, {
      method: 'DELETE',
    })
    expect(res.body?.data?.released).toBe(false)
    expect((await adminDb.slotHold.findUnique({ where: { id: hold.id } }))?.status).toBe('ACTIVE')
  })
})

describe('security headers (B0.6.2)', () => {
  it('helmet headers and HSTS are present on API responses', async () => {
    const res = await api(server.url, '/health')
    const h = res.headers
    expect(h.get('strict-transport-security')).toMatch(/max-age=\d{7,}/)
    expect(h.get('x-content-type-options')).toBe('nosniff')
    expect(h.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(h.get('content-security-policy')).toBeTruthy()
    expect(h.get('referrer-policy')).toBe('no-referrer')
    expect(h.get('x-powered-by')).toBeNull()
  })
})

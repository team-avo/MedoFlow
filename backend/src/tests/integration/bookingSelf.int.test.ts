/**
 * Demo feedback WS1 — simplified patient booking.
 *
 *  - Patients book for themselves only ("book for someone else" is deferred).
 *  - The patient's phone lives on their profile (encrypted at rest) so the
 *    booking Review step can auto-fill it.
 *  - Session handoff: a patient signed in on the app host gets a session on a
 *    clinic's own domain without signing in again (services/authHandoffService).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FIXTURE_PASSWORD,
  adminDb,
  api,
  login,
  refreshCookieFrom,
  startServer,
  type TestServer,
} from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'
import { invalidateHostCache } from '../../site/services/hostService'

let server: TestServer
let C: ClinicFixture
let otherPatientId: string
let patientToken: string
let adminToken: string
let label: string
let clinicOrigin: string

beforeAll(async () => {
  server = await startServer()
  C = await createClinicFixture('book-self')
  label = `bookself${Date.now().toString(36)}`
  await adminDb.siteDomain.create({
    data: {
      clinicId: C.clinicId,
      hostname: label,
      kind: 'SUBDOMAIN',
      status: 'VERIFIED',
      isPrimary: true,
    },
  })
  invalidateHostCache()
  clinicOrigin = `https://${label}.site.test`

  const other = await adminDb.user.create({
    data: {
      clinicId: C.clinicId,
      name: 'Other Synthetic Patient',
      email: `other.${label}@example.test`,
      password: 'unused-hash',
      role: 'PATIENT',
    },
  })
  otherPatientId = other.id
  patientToken = (await login(server.url, C.users.patient.email)).accessToken
  adminToken = (await login(server.url, C.users.admin.email)).accessToken
})
afterAll(async () => {
  invalidateHostCache()
  await server.close()
})

const booking = (extra: Record<string, unknown>, offset: number) => ({
  providerId: C.providerId,
  serviceId: C.serviceId,
  locationId: C.locationId,
  ...slot(offset, 10),
  ...extra,
})

describe('self-booking only', () => {
  it('a patient cannot book for another patient (403), on either booking route', async () => {
    const single = await api(server.url, '/appointments', {
      token: patientToken,
      body: booking({ patientId: otherPatientId }, 20),
    })
    expect(single.status, JSON.stringify(single.body)).toBe(403)

    const series = await api(server.url, '/appointments/recurring', {
      token: patientToken,
      body: booking({ patientId: otherPatientId, frequency: 'WEEKLY', numberOfSessions: 2 }, 21),
    })
    expect(series.status, JSON.stringify(series.body)).toBe(403)
    expect(await adminDb.appointment.count({ where: { patientId: otherPatientId } })).toBe(0)
  })

  it('a patient naming themselves (or no one) books normally', async () => {
    const res = await api(server.url, '/appointments', {
      token: patientToken,
      body: booking({ patientId: C.users.patient.id }, 22),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.appointment.patientId).toBe(C.users.patient.id)
  })

  it('front desk can still book on behalf of a patient of their clinic', async () => {
    const fd = (await login(server.url, C.users.frontDesk.email)).accessToken
    const res = await api(server.url, '/appointments', {
      token: fd,
      body: booking({ patientId: C.users.patient.id }, 23),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })
})

describe('patient phone on the profile', () => {
  it('registration stores the phone (sealed at rest) and /auth/me returns it', async () => {
    const email = `phone.${label}@example.test`
    const reg = await api(server.url, '/auth/register', {
      body: {
        name: 'Phone Synthetic',
        email,
        password: FIXTURE_PASSWORD,
        phone: '+1 555 010 2030',
      },
    })
    expect(reg.status, JSON.stringify(reg.body)).toBe(201)

    const raw = await adminDb.user.findUniqueOrThrow({ where: { email }, select: { phone: true } })
    expect(raw.phone).toMatch(/^fle:v1:/)

    const { accessToken } = await login(server.url, email, FIXTURE_PASSWORD)
    const me = await api(server.url, '/auth/me', { token: accessToken })
    expect(me.body.data.user.phone).toBe('+1 555 010 2030')
  })

  it('rejects a malformed phone at registration and on PATCH /auth/me', async () => {
    const reg = await api(server.url, '/auth/register', {
      body: {
        name: 'Bad Phone',
        email: `badphone.${label}@example.test`,
        password: FIXTURE_PASSWORD,
        phone: 'call me maybe',
      },
    })
    expect(reg.status).toBe(400)
    const patch = await api(server.url, '/auth/me', {
      method: 'PATCH',
      token: patientToken,
      body: { phone: '12' },
    })
    expect(patch.status).toBe(400)
  })

  it('PATCH /auth/me sets and clears the phone', async () => {
    const set = await api(server.url, '/auth/me', {
      method: 'PATCH',
      token: patientToken,
      body: { phone: '(555) 010-4455' },
    })
    expect(set.status, JSON.stringify(set.body)).toBe(200)
    expect(set.body.data.user.phone).toBe('(555) 010-4455')
    const me = await api(server.url, '/auth/me', { token: patientToken })
    expect(me.body.data.user.phone).toBe('(555) 010-4455')

    const cleared = await api(server.url, '/auth/me', {
      method: 'PATCH',
      token: patientToken,
      body: { phone: null },
    })
    expect(cleared.body.data.user.phone).toBeNull()
  })
})

describe('session handoff to a clinic domain', () => {
  const returnUrl = () => `${clinicOrigin}/book/${C.serviceId}?clinicId=${C.clinicId}`
  const start = (token?: string, url: string = returnUrl()) =>
    api(server.url, '/auth/handoff/start', { token, body: { returnUrl: url } })
  const exchange = (code: string, origin: string | null = clinicOrigin) =>
    api(server.url, '/auth/handoff/exchange', {
      body: { code },
      headers: origin ? { origin } : {},
    })
  const codeOf = (redirectUrl: string) => new URL(redirectUrl).searchParams.get('handoff')!

  it('refuses return URLs that are not a live clinic site (no open redirect)', async () => {
    for (const url of [
      'https://evil.example.com/book/x',
      `https://unknown-${label}.site.test/book/x`,
      `http://${label}.site.test/book/x`, // not https
      `https://user:pw@${label}.site.test/book/x`,
      'javascript:alert(1)',
      '',
    ]) {
      const res = await start(patientToken, url)
      expect(res.status, url).toBe(400)
    }
  })

  it('anonymous callers and staff are sent back with handoff=none', async () => {
    for (const token of [undefined, adminToken, 'not-a-jwt']) {
      const res = await start(token)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const back = new URL(res.body.data.redirectUrl)
      expect(back.origin).toBe(clinicOrigin)
      expect(back.searchParams.get('handoff')).toBe('none')
      expect(back.searchParams.get('clinicId')).toBe(C.clinicId)
    }
  })

  it('a signed-in patient gets a one-time code that signs them in on the clinic origin', async () => {
    const res = await start(patientToken)
    expect(res.status).toBe(200)
    const code = codeOf(res.body.data.redirectUrl)
    expect(code).not.toBe('none')

    // Only a hash is stored.
    const rows = await adminDb.authHandoffCode.findMany({
      where: { userId: C.users.patient.id, usedAt: null },
    })
    expect(rows.some((r) => r.codeHash === code)).toBe(false)
    expect(rows.every((r) => r.origin === clinicOrigin)).toBe(true)

    const ex = await exchange(code)
    expect(ex.status, JSON.stringify(ex.body)).toBe(200)
    expect(ex.body.data.accessToken).toBeTruthy()
    expect(ex.body.data.user).toMatchObject({ id: C.users.patient.id, role: 'PATIENT' })
    expect(refreshCookieFrom(ex.setCookie)).toMatch(/^refreshToken=/)

    const me = await api(server.url, '/auth/me', { token: ex.body.data.accessToken })
    expect(me.body.data.user.id).toBe(C.users.patient.id)

    const audit = await adminDb.auditLog.count({
      where: { performedById: C.users.patient.id, action: 'SESSION_HANDOFF' },
    })
    expect(audit).toBeGreaterThan(0)
  })

  it('a code works once, only from its origin, and not after it expires', async () => {
    const reused = codeOf((await start(patientToken)).body.data.redirectUrl)
    expect((await exchange(reused)).status).toBe(200)
    expect((await exchange(reused)).status).toBe(401)

    const wrongOrigin = codeOf((await start(patientToken)).body.data.redirectUrl)
    expect((await exchange(wrongOrigin, 'https://evil.example.com')).status).toBe(401)
    expect((await exchange(wrongOrigin, null)).status).toBe(401)

    const expired = codeOf((await start(patientToken)).body.data.redirectUrl)
    await adminDb.authHandoffCode.updateMany({
      where: { userId: C.users.patient.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await exchange(expired)).status).toBe(401)

    expect((await exchange('x'.repeat(43))).status).toBe(401)
  })

  it('two concurrent exchanges of one code: exactly one session', async () => {
    const code = codeOf((await start(patientToken)).body.data.redirectUrl)
    const results = await Promise.all([exchange(code), exchange(code)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 401])
  })

  it('a deactivated patient cannot be handed off', async () => {
    const code = codeOf((await start(patientToken)).body.data.redirectUrl)
    await adminDb.user.update({ where: { id: C.users.patient.id }, data: { isActive: false } })
    try {
      expect((await exchange(code)).status).toBe(401)
    } finally {
      await adminDb.user.update({ where: { id: C.users.patient.id }, data: { isActive: true } })
    }
  })
})

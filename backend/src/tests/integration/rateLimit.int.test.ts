/**
 * B0.2.4 — rate limiting on auth endpoints, with the real production limits.
 * Own file: the limiter is in-memory per process and keyed by client IP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

let server: TestServer
let C: ClinicFixture

beforeAll(async () => {
  delete process.env.AUTH_RATE_LIMIT_MAX
  delete process.env.REFRESH_RATE_LIMIT_MAX
  server = await startServer()
  C = await createClinicFixture('ratelimit')
})
afterAll(() => server.close())

describe('auth rate limits', () => {
  it('normal traffic is unaffected: successful logins never consume the failure budget', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await api(server.url, '/auth/login', {
        body: { email: C.users.admin.email, password: 'Synthetic-Test-Pass-2026' },
      })
      expect(res.status).toBe(200)
    }
  })

  it('refresh is limited separately (60/min), so 429 arrives only after the ceiling', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    const statuses: number[] = []
    for (let i = 0; i < 62; i++) {
      // A bogus cookie: 401 each time, until the limiter answers 429.
      statuses.push(
        (
          await api(server.url, '/auth/refresh-token', {
            method: 'POST',
            cookie: 'refreshToken=bogus',
          })
        ).status
      )
    }
    expect(statuses.slice(0, 60).every((c) => c === 401)).toBe(true)
    expect(statuses.slice(60)).toEqual([429, 429])
    // The login failure budget is untouched by refresh traffic.
    expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
  })

  it('5 failed logins within the window → the 6th attempt is 429 (even with the right password)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await api(server.url, '/auth/login', {
        body: { email: C.users.patient.email, password: 'wrong' },
      })
      expect(res.status).toBe(401)
    }
    const blocked = await api(server.url, '/auth/login', {
      body: { email: C.users.patient.email, password: 'Synthetic-Test-Pass-2026' },
    })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('ratelimit-limit') ?? blocked.headers.get('ratelimit')).toBeTruthy()
  })

  it('the same budget covers the MFA challenge endpoint', async () => {
    const res = await api(server.url, '/auth/mfa/verify', {
      body: { mfaToken: 'x', code: '000000' },
    })
    expect(res.status).toBe(429)
  })
})

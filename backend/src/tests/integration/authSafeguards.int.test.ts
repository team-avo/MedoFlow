/**
 * B0.2 — identity, sessions and access safeguards, end to end over HTTP:
 *  B0.2.1 logout + refresh rotation invalidate tokens
 *  B0.2.2 MFA enrol → challenge (valid / invalid / replayed / expired) → recovery code
 *  B0.2.3 idle timeout is enforced server-side
 *  B0.2.5 deactivation revokes access
 *  B0.2.6 break-glass: justification, time-box, auto-expiry, audit rows
 *  B0.3.4 auth events (login ok/failed, password change, permission change) are audited
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  adminDb,
  api,
  login,
  refreshCookieFrom,
  startServer,
  FIXTURE_PASSWORD,
  type TestServer,
} from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { totpAt, timeStep } from '../../utils/totp'
import { expireBreakGlassGrants } from '../../services/breakGlassService'

let server: TestServer
let C: ClinicFixture

beforeAll(async () => {
  server = await startServer()
  C = await createClinicFixture('auth')
})
afterAll(() => server.close())

const auditRows = (userId: string, action: string) =>
  adminDb.auditLog.findMany({
    where: { performedById: userId, action },
    orderBy: { createdAt: 'desc' },
  })

describe('B0.2.1 sessions: logout and refresh rotation', () => {
  it('after logout both the access token and the refresh token are rejected (401)', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)

    const out = await api(server.url, '/auth/logout', {
      method: 'POST',
      token: s.accessToken,
      cookie: s.refreshCookie,
    })
    expect(out.status).toBe(200)

    const me = await api(server.url, '/auth/me', { token: s.accessToken })
    expect(me.status).toBe(401)
    expect(me.body.code).toBe('session_revoked')
    expect(
      (await api(server.url, '/auth/refresh-token', { method: 'POST', cookie: s.refreshCookie }))
        .status
    ).toBe(401)
    expect(await auditRows(s.userId, 'LOGOUT')).not.toHaveLength(0)
  })

  it('a rotated refresh token invalidates the old one; replaying it revokes the session', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    const r1 = await api(server.url, '/auth/refresh-token', {
      method: 'POST',
      cookie: s.refreshCookie,
    })
    expect(r1.status).toBe(200)
    const newCookie = refreshCookieFrom(r1.setCookie)

    const replay = await api(server.url, '/auth/refresh-token', {
      method: 'POST',
      cookie: s.refreshCookie,
    })
    expect(replay.status).toBe(401)
    // Reuse detection revoked every session, including the rotated one.
    expect(
      (await api(server.url, '/auth/refresh-token', { method: 'POST', cookie: newCookie })).status
    ).toBe(401)
    expect((await api(server.url, '/auth/me', { token: r1.body.data.accessToken })).status).toBe(
      401
    )
    expect(await auditRows(s.userId, 'REFRESH_TOKEN_REUSE')).not.toHaveLength(0)
  })

  it('a token without a session id (pre-B0 token) is rejected', async () => {
    const legacy = jwt.sign(
      { userId: C.users.admin.id, role: 'SUPER_ADMIN' },
      process.env.JWT_SECRET!,
      { expiresIn: '15m' }
    )
    expect((await api(server.url, '/auth/me', { token: legacy })).status).toBe(401)
  })

  it('a token signed with the previous secret is accepted during rotation, and rejected after', async () => {
    const s = await login(server.url, C.users.admin.email)
    const current = process.env.JWT_SECRET!
    process.env.JWT_SECRET_PREVIOUS = current
    process.env.JWT_SECRET = 'b'.repeat(16) + 'rotated-secret-0123456789abcdef0123456789abcdef'
    try {
      expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
      delete process.env.JWT_SECRET_PREVIOUS
      expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(401)
    } finally {
      process.env.JWT_SECRET = current
      delete process.env.JWT_SECRET_PREVIOUS
    }
  })
})

describe('B0.2.3 idle session timeout', () => {
  it('a session idle past the window is revoked server-side and the next request is 401', async () => {
    const s = await login(server.url, C.users.provider.email)
    const sid = (jwt.decode(s.accessToken) as { sid: string }).sid
    await adminDb.userSession.update({
      where: { id: sid },
      data: { lastActivityAt: new Date(Date.now() - 16 * 60_000) },
    })
    const res = await api(server.url, '/auth/me', { token: s.accessToken })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('session_idle_timeout')
    const session = await adminDb.userSession.findUnique({ where: { id: sid } })
    expect(session?.revokedReason).toBe('idle_timeout')
    expect(
      (await api(server.url, '/auth/refresh-token', { method: 'POST', cookie: s.refreshCookie }))
        .status
    ).toBe(401)
    expect(await auditRows(s.userId, 'SESSION_IDLE_TIMEOUT')).not.toHaveLength(0)
  })

  it('the window is configurable per deployment (SESSION_IDLE_TIMEOUT_MINUTES)', async () => {
    const s = await login(server.url, C.users.provider.email)
    const sid = (jwt.decode(s.accessToken) as { sid: string }).sid
    await adminDb.userSession.update({
      where: { id: sid },
      data: { lastActivityAt: new Date(Date.now() - 16 * 60_000) },
    })
    process.env.SESSION_IDLE_TIMEOUT_MINUTES = '30'
    try {
      expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
    } finally {
      process.env.SESSION_IDLE_TIMEOUT_MINUTES = '15'
    }
  })

  it('an active session keeps working (activity is recorded)', async () => {
    const s = await login(server.url, C.users.provider.email)
    const sid = (jwt.decode(s.accessToken) as { sid: string }).sid
    await adminDb.userSession.update({
      where: { id: sid },
      data: { lastActivityAt: new Date(Date.now() - 10 * 60_000) },
    })
    expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
    const after = await adminDb.userSession.findUnique({ where: { id: sid } })
    expect(Date.now() - after!.lastActivityAt.getTime()).toBeLessThan(60_000)
  })
})

describe('B0.2.2 MFA for staff', () => {
  let secret = ''
  let recoveryCodes: string[] = []

  it('enrolment: setup → enable with a valid code returns recovery codes; an invalid code fails', async () => {
    const s = await login(server.url, C.users.admin.email)
    const setup = await api(server.url, '/auth/mfa/setup', { method: 'POST', token: s.accessToken })
    expect(setup.status).toBe(200)
    secret = setup.body.data.secret
    expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)

    const bad = await api(server.url, '/auth/mfa/enable', {
      token: s.accessToken,
      body: { code: '000000' },
    })
    expect(bad.status).toBe(400)

    const ok = await api(server.url, '/auth/mfa/enable', {
      token: s.accessToken,
      body: { code: totpAt(secret, timeStep()) },
    })
    expect(ok.status).toBe(200)
    recoveryCodes = ok.body.data.recoveryCodes
    expect(recoveryCodes).toHaveLength(10)
    // Stored encrypted / hashed, never in clear.
    const u = await adminDb.user.findUnique({ where: { id: C.users.admin.id } })
    expect(u?.mfaSecret).not.toContain(secret)
    expect(JSON.stringify(u?.mfaRecoveryCodes)).not.toContain(recoveryCodes[0])
    expect(await auditRows(C.users.admin.id, 'MFA_ENABLED')).not.toHaveLength(0)
  })

  it('after enrolment a password-only login gets no tokens (blocked until the challenge passes)', async () => {
    const res = await api(server.url, '/auth/login', {
      body: { email: C.users.admin.email, password: FIXTURE_PASSWORD },
    })
    expect(res.status).toBe(200)
    expect(res.body.data.mfaRequired).toBe(true)
    expect(res.body.data.accessToken).toBeUndefined()
    expect(res.setCookie.some((c) => c.startsWith('refreshToken='))).toBe(false)
  })

  it('a valid TOTP passes; an invalid, a replayed and an expired-challenge attempt fail', async () => {
    const challenge = await api(server.url, '/auth/login', {
      body: { email: C.users.admin.email, password: FIXTURE_PASSWORD },
    })
    const mfaToken = challenge.body.data.mfaToken as string

    const wrong = await api(server.url, '/auth/mfa/verify', { body: { mfaToken, code: '123456' } })
    expect(wrong.status).toBe(401)

    const code = totpAt(secret, timeStep() + 1)
    const ok = await api(server.url, '/auth/mfa/verify', { body: { mfaToken, code } })
    expect(ok.status).toBe(200)
    expect(ok.body.data.accessToken).toBeTruthy()
    expect((await api(server.url, '/auth/me', { token: ok.body.data.accessToken })).status).toBe(
      200
    )

    const replay = await api(server.url, '/auth/mfa/verify', { body: { mfaToken, code } })
    expect(replay.status).toBe(401)

    const expired = jwt.sign(
      { userId: C.users.admin.id, purpose: 'mfa' },
      process.env.JWT_SECRET!,
      { expiresIn: -10 }
    )
    const late = await api(server.url, '/auth/mfa/verify', {
      body: { mfaToken: expired, code: totpAt(secret, timeStep() + 1) },
    })
    expect(late.status).toBe(401)
    expect(await auditRows(C.users.admin.id, 'MFA_CHALLENGE_FAILURE')).not.toHaveLength(0)
  })

  it('recovery path: a recovery code signs in once and cannot be reused', async () => {
    const challenge = await api(server.url, '/auth/login', {
      body: { email: C.users.admin.email, password: FIXTURE_PASSWORD },
    })
    const mfaToken = challenge.body.data.mfaToken as string
    const first = await api(server.url, '/auth/mfa/verify', {
      body: { mfaToken, recoveryCode: recoveryCodes[0] },
    })
    expect(first.status).toBe(200)
    const again = await api(server.url, '/auth/mfa/verify', {
      body: { mfaToken, recoveryCode: recoveryCodes[0] },
    })
    expect(again.status).toBe(401)
    expect(await auditRows(C.users.admin.id, 'MFA_RECOVERY_CODE_USED')).not.toHaveLength(0)
  })

  it('a session created before enrolment can no longer be used', async () => {
    // Fresh user: log in, then enable MFA from a second session.
    const before = await login(server.url, C.users.provider.email)
    const enrolling = await login(server.url, C.users.provider.email)
    const setup = await api(server.url, '/auth/mfa/setup', {
      method: 'POST',
      token: enrolling.accessToken,
    })
    await api(server.url, '/auth/mfa/enable', {
      token: enrolling.accessToken,
      body: { code: totpAt(setup.body.data.secret, timeStep()) },
    })
    expect((await api(server.url, '/auth/me', { token: before.accessToken })).status).toBe(401)
    expect((await api(server.url, '/auth/me', { token: enrolling.accessToken })).status).toBe(200)
  })
})

describe('B0.2.5 deactivation revokes access', () => {
  it('a deactivated user is refused on the next request', async () => {
    const fx = await createClinicFixture('deact')
    const s = await login(server.url, fx.users.frontDesk.email)
    await adminDb.user.update({ where: { id: fx.users.frontDesk.id }, data: { isActive: false } })
    const res = await api(server.url, '/auth/me', { token: s.accessToken })
    expect([401, 403]).toContain(res.status)
  })
})

describe('B0.2.6 break-glass emergency access', () => {
  it('requires a justification and a bounded duration', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    expect(
      (
        await api(server.url, '/auth/break-glass', {
          token: s.accessToken,
          body: { reason: 'short' },
        })
      ).status
    ).toBe(400)
    expect(
      (
        await api(server.url, '/auth/break-glass', {
          token: s.accessToken,
          body: {
            reason: 'Patient collapsed in waiting room, need allergy history',
            durationMinutes: 600,
          },
        })
      ).status
    ).toBe(400)
  })

  it('elevates within the own clinic only, audits every use, and auto-expires', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    // Front desk normally can't open the staff directory…
    expect((await api(server.url, '/staff', { token: s.accessToken })).status).toBe(403)

    const act = await api(server.url, '/auth/break-glass', {
      token: s.accessToken,
      body: {
        reason: 'Patient collapsed in waiting room, need allergy history',
        durationMinutes: 5,
      },
    })
    expect(act.status).toBe(201)
    const grantId = act.body.data.grant.id as string

    // …but can during an active grant, and every request is audited as critical.
    expect((await api(server.url, '/staff', { token: s.accessToken })).status).toBe(200)
    const activated = await adminDb.auditLog.findMany({
      where: { entityId: grantId, action: 'BREAK_GLASS_ACTIVATED' },
    })
    expect(activated).toHaveLength(1)
    expect(activated[0]!.severity).toBe('critical')
    const uses = await adminDb.auditLog.findMany({
      where: { entityId: grantId, action: 'BREAK_GLASS_ACCESS' },
    })
    expect(uses.length).toBeGreaterThan(0)
    expect(uses.every((u) => u.severity === 'critical')).toBe(true)

    // Never crosses clinics.
    const other = await createClinicFixture('bg-other')
    expect([403, 404]).toContain(
      (await api(server.url, `/visits/${other.visitRecordId}`, { token: s.accessToken })).status
    )

    // Time-boxed: once expiresAt passes, access is gone without any action.
    await adminDb.breakGlassGrant.update({
      where: { id: grantId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await api(server.url, '/staff', { token: s.accessToken })).status).toBe(403)
    expect(await expireBreakGlassGrants()).toBeGreaterThanOrEqual(1)
    const expired = await adminDb.auditLog.findMany({
      where: { entityId: grantId, action: 'BREAK_GLASS_EXPIRED' },
    })
    expect(expired).toHaveLength(1)
  })

  it('patients cannot use break-glass', async () => {
    const s = await login(server.url, C.users.patient.email)
    const res = await api(server.url, '/auth/break-glass', {
      token: s.accessToken,
      body: { reason: 'I would like to see everything in the clinic', durationMinutes: 5 },
    })
    expect(res.status).toBe(403)
  })
})

describe('B0.3.4 authentication events are audited', () => {
  it('login success and failure (unknown email + wrong password) write audit rows without the raw email', async () => {
    const fx = await createClinicFixture('authev')
    await login(server.url, fx.users.patient.email)
    expect(await auditRows(fx.users.patient.id, 'LOGIN_SUCCESS')).toHaveLength(1)

    await api(server.url, '/auth/login', {
      body: { email: fx.users.patient.email, password: 'wrong-password' },
    })
    const failed = await auditRows(fx.users.patient.id, 'LOGIN_FAILURE')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.ipAddress).toBeTruthy()

    const ghost = `ghost-${Date.now()}@example.test`
    await api(server.url, '/auth/login', { body: { email: ghost, password: 'x' } })
    const unknown = await adminDb.auditLog.findFirst({
      where: { action: 'LOGIN_FAILURE', performedById: null },
      orderBy: { createdAt: 'desc' },
    })
    expect(unknown?.clinicId).toBeNull()
    expect(JSON.stringify(unknown)).not.toContain(ghost)
  })

  it('password change writes an audit row and signs out other sessions', async () => {
    const fx = await createClinicFixture('pwchange')
    const other = await login(server.url, fx.users.patient.email)
    const s = await login(server.url, fx.users.patient.email)
    const res = await api(server.url, '/auth/change-password', {
      token: s.accessToken,
      body: { currentPassword: FIXTURE_PASSWORD, newPassword: 'Another-Synthetic-Pass-1' },
    })
    expect(res.status).toBe(200)
    expect(await auditRows(fx.users.patient.id, 'PASSWORD_CHANGED')).toHaveLength(1)
    expect((await api(server.url, '/auth/me', { token: other.accessToken })).status).toBe(401)
    expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
  })

  it('permission change (staff role update) writes a PERMISSION_CHANGED row', async () => {
    const fx = await createClinicFixture('permchange')
    const s = await login(server.url, fx.users.admin.email)
    const res = await api(server.url, `/staff/${fx.users.frontDesk.id}`, {
      method: 'PATCH',
      token: s.accessToken,
      body: { role: 'ACCOUNTING' },
    })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const rows = await adminDb.auditLog.findMany({
      where: { entityId: fx.users.frontDesk.id, action: 'PERMISSION_CHANGED' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.performedById).toBe(fx.users.admin.id)
  })
})

describe('F0.2 client contract: refresh cookie, CSRF header, heartbeat', () => {
  it('refresh and logout refuse a request without the client header (CSRF guard)', async () => {
    const s = await login(server.url, C.users.frontDesk.email)
    const noHeader = { 'x-medoflow-client': '' }
    const refresh = await api(server.url, '/auth/refresh-token', {
      method: 'POST',
      cookie: s.refreshCookie,
      headers: noHeader,
    })
    expect(refresh.status).toBe(403)
    expect(refresh.body.code).toBe('client_header_required')
    const out = await api(server.url, '/auth/logout', {
      method: 'POST',
      cookie: s.refreshCookie,
      headers: noHeader,
    })
    expect(out.status).toBe(403)
    // Nothing was revoked: the session still works and refresh still succeeds with the header.
    expect((await api(server.url, '/auth/me', { token: s.accessToken })).status).toBe(200)
    expect(
      (await api(server.url, '/auth/refresh-token', { method: 'POST', cookie: s.refreshCookie }))
        .status
    ).toBe(200)
  })

  it('the refresh cookie is HttpOnly (never readable by page script)', async () => {
    const res = await api(server.url, '/auth/login', {
      // patient: never enrols MFA in this suite, so login returns tokens
      body: { email: C.users.patient.email, password: FIXTURE_PASSWORD },
    })
    const cookie = res.setCookie.find((c) => c.startsWith('refreshToken='))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(res.body.data.accessToken).toBeTruthy()
  })

  it('/auth/me and the /auth/session heartbeat report the idle window', async () => {
    const s = await login(server.url, C.users.patient.email)
    const me = await api(server.url, '/auth/me', { token: s.accessToken })
    expect(me.body.data.session.idleTimeoutMinutes).toBe(15)
    const hb = await api(server.url, '/auth/session', { token: s.accessToken })
    expect(hb.status).toBe(200)
    expect(hb.body.data.session.idleTimeoutMinutes).toBe(15)
    expect((await api(server.url, '/auth/session')).status).toBe(401)
  })
})

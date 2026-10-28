/**
 * Stateful stand-in for the MedoFlow API, installed with page.route(). It
 * implements the auth contract the app depends on — login (+ MFA challenge),
 * refresh cookie, /auth/me, logout, MFA setup/enable — and verifies real
 * RFC 6238 TOTP codes, so the browser flow is exercised exactly as against
 * the backend. Every other API call gets an empty success response.
 * Synthetic data only.
 */
import type { Page, Route } from '@playwright/test'
import { createHmac, randomBytes } from 'node:crypto'

export const STAFF_EMAIL = 'frontdesk.e2e@example.test'
export const STAFF_PASSWORD = 'Synthetic-E2E-Pass-2026'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** RFC 6238 TOTP, SHA-1, 30 s step, 6 digits (same parameters as the backend). */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = h[h.length - 1]! & 0xf
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(bin).padStart(6, '0')
}

export interface MockState {
  mfaEnabled: boolean
  secret: string | null
  pendingSecret: string | null
  sessionLive: boolean
  calls: string[]
}

export const ok = (route: Route, data: unknown, extra: Record<string, string> = {}) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders(route, extra),
    body: JSON.stringify({ success: true, message: 'ok', data }),
  })

export const fail = (route: Route, status: number, code: string, message: string) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: corsHeaders(route),
    body: JSON.stringify({ success: false, code, message }),
  })

export function corsHeaders(route: Route, extra: Record<string, string> = {}) {
  const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1:4310'
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization, x-medoflow-client',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...extra,
  }
}

export type MockRole =
  | 'FRONT_DESK'
  | 'SUPER_ADMIN'
  | 'PATIENT'
  | 'PROVIDER'
  | 'MARKETING'
  | 'PLATFORM_ADMIN'

/** The signed-in identity per role (synthetic). Patient values double as the PHI probe. */
export const MOCK_USERS: Record<MockRole, { id: string; name: string; email: string }> = {
  FRONT_DESK: { id: 'user-e2e-1', name: 'Synthetic Front Desk', email: STAFF_EMAIL },
  SUPER_ADMIN: { id: 'user-e2e-admin', name: 'Synthetic Admin', email: 'admin.e2e@example.test' },
  PATIENT: { id: 'patient-e2e-1', name: 'Quinn Marlowe', email: 'quinn.marlowe@example.test' },
  PROVIDER: { id: 'user-e2e-provider', name: 'Avery Stone', email: 'provider.e2e@example.test' },
  MARKETING: { id: 'user-e2e-marketing', name: 'Rowan Hale', email: 'marketing.e2e@example.test' },
  PLATFORM_ADMIN: {
    id: 'user-e2e-platform',
    name: 'Sam Ortiz',
    email: 'platform.e2e@example.test',
  },
}

export async function installMockApi(
  page: Page,
  opts: {
    idleTimeoutMinutes?: number
    role?: MockRole
    /** Start with a live session (the refresh cookie exchange succeeds on load). */
    signedIn?: boolean
    /** Override the signed-in name/email/clinic name, e.g. long values for layout checks. */
    identity?: { name?: string; email?: string; clinicName?: string }
  } = {}
) {
  const state: MockState = {
    mfaEnabled: false,
    secret: null,
    pendingSecret: null,
    sessionLive: opts.signedIn ?? false,
    calls: [],
  }
  const idleTimeoutMinutes = opts.idleTimeoutMinutes ?? 15
  const role: MockRole = opts.role ?? 'FRONT_DESK'
  const user = () => ({
    ...MOCK_USERS[role],
    ...(opts.identity?.name ? { name: opts.identity.name } : {}),
    ...(opts.identity?.email ? { email: opts.identity.email } : {}),
    role,
    clinicId: 'clinic-e2e',
    permissions: [],
    // Skip the first-run product tour overlay.
    hasSeenTour: true,
    hasSeenPatientTour: true,
    tourCompletedAt: '2026-01-01T00:00:00.000Z',
    mfaEnabled: state.mfaEnabled,
    clinic: {
      id: 'clinic-e2e',
      name: opts.identity?.clinicName ?? 'Synthetic Clinic',
      tenant: {
        id: 'tenant-e2e',
        name: 'Synthetic Tenant',
        onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
        onboardingStep: 9,
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
        termsVersion: '1',
      },
    },
  })
  const issue = (route: Route) => {
    state.sessionLive = true
    return ok(
      route,
      { accessToken: `access-${Date.now()}`, user: user() },
      { 'set-cookie': 'refreshToken=e2e; Path=/; HttpOnly; SameSite=Lax' }
    )
  }

  await page.route('http://127.0.0.1:3999/**', async (route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route) })
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    state.calls.push(`${method} ${path}`)
    const body = (req.postDataJSON?.() ?? {}) as Record<string, string>
    const authed = state.sessionLive && !!req.headers()['authorization']

    switch (`${method} ${path}`) {
      case 'POST /auth/login':
        if (body.email !== STAFF_EMAIL || body.password !== STAFF_PASSWORD) {
          return fail(route, 401, 'invalid_credentials', 'Invalid email or password')
        }
        if (state.mfaEnabled) return ok(route, { mfaRequired: true, mfaToken: 'mfa-challenge-e2e' })
        return issue(route)
      case 'POST /auth/mfa/verify':
        if (body.mfaToken !== 'mfa-challenge-e2e')
          return fail(route, 401, 'mfa_challenge_invalid', 'MFA challenge expired — sign in again')
        if (!state.secret || body.code !== totp(state.secret)) {
          return fail(route, 401, 'mfa_invalid_code', 'Invalid verification code')
        }
        return issue(route)
      case 'POST /auth/refresh-token':
        if (!req.headers()['x-medoflow-client'])
          return fail(route, 403, 'client_header_required', 'Missing client header')
        return state.sessionLive
          ? ok(route, { accessToken: `access-${Date.now()}` })
          : fail(route, 401, 'session_revoked', 'Session ended')
      case 'POST /auth/logout':
        state.sessionLive = false
        return ok(route, {})
      case 'GET /auth/me':
        return authed
          ? ok(route, { user: user(), session: { idleTimeoutMinutes } })
          : fail(route, 401, 'unauthorized', 'Not authenticated')
      case 'GET /auth/session':
        return authed
          ? ok(route, { session: { idleTimeoutMinutes } })
          : fail(route, 401, 'unauthorized', 'Not authenticated')
      case 'POST /auth/mfa/setup': {
        if (!authed) return fail(route, 401, 'unauthorized', 'Not authenticated')
        state.pendingSecret = base32Encode(randomBytes(20))
        return ok(route, {
          secret: state.pendingSecret,
          otpauthUrl: `otpauth://totp/MedoFlow:${encodeURIComponent(STAFF_EMAIL)}?secret=${state.pendingSecret}&issuer=MedoFlow`,
        })
      }
      case 'POST /auth/mfa/enable':
        if (!authed || !state.pendingSecret)
          return fail(route, 400, 'mfa_not_started', 'Start setup first')
        if (body.code !== totp(state.pendingSecret))
          return fail(route, 400, 'mfa_invalid_code', 'Invalid verification code')
        state.secret = state.pendingSecret
        state.pendingSecret = null
        state.mfaEnabled = true
        return ok(route, {
          recoveryCodes: Array.from({ length: 8 }, (_, i) => `e2e0-rc0${i}-${1000 + i}`),
        })
      default:
        // Anything else the dashboard chrome asks for: an empty, successful answer.
        return authed ? ok(route, {}) : fail(route, 401, 'unauthorized', 'Not authenticated')
    }
  })
  return state
}

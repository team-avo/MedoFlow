/**
 * B0 unit checks that need no database:
 *  B0.1.1 production refuses to boot unless isolation is `enforce`
 *  B0.2.1 weak JWT secrets fail the boot check
 *  B0.3.5 PHI never reaches logs, stack traces, error responses or alert payloads
 *  B0.3.6 retention below 6 years fails the boot check
 *  B0.2.2 TOTP matches the RFC 6238 test vector
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { collectEnvProblems, validateProductionEnv } from '../config/envValidation'
import { jwtSecretWeakness } from '../utils/tokenUtils'
import { scrubPhi, scrubText, scrubUrl, installConsoleScrubber } from '../utils/phiScrubber'
import { logError } from '../utils/errorLogger'
import { errorHandler } from '../middleware/errorHandler'
import { base32Encode, totpAt, verifyTotp } from '../utils/totp'
import { raiseAlert, resetSecurityMonitor } from '../services/securityMonitorService'

const STRONG = 'f3a9c1d7e5b2084a6c9e1f3d5b7a90c2e4f6a8b0c1d3e5f7091b2c3d4e5f6a7b'
const baseEnv = (over: Record<string, string | undefined> = {}) =>
  ({
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: STRONG,
    CORS_ORIGIN: 'https://app',
    ...over,
  }) as NodeJS.ProcessEnv

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('B0.2.1 JWT secret strength', () => {
  it('rejects short, placeholder and low-entropy secrets; accepts openssl rand -hex 32', () => {
    expect(jwtSecretWeakness(undefined)).toMatch(/not set/)
    expect(jwtSecretWeakness('short')).toMatch(/shorter than 32/)
    expect(jwtSecretWeakness('change-me-at-least-32-characters-long')).toMatch(/placeholder/)
    expect(jwtSecretWeakness('a'.repeat(64))).toMatch(/entropy/)
    expect(jwtSecretWeakness('abababababababababababababababab')).toMatch(/entropy/)
    expect(jwtSecretWeakness(STRONG)).toBeNull()
  })

  it('a weak secret is a fatal boot problem', () => {
    const problems = collectEnvProblems(baseEnv({ JWT_SECRET: 'x'.repeat(40) }))
    expect(problems.some((p) => p.fatal && p.message.startsWith('JWT_SECRET'))).toBe(true)
  })
})

describe('B0.1.1 / B0.3.6 boot refusal', () => {
  it('isolation mode other than enforce is fatal', () => {
    vi.stubEnv('TENANT_ISOLATION_MODE', 'warn')
    expect(
      collectEnvProblems(baseEnv()).some((p) => p.fatal && /TENANT_ISOLATION_MODE/.test(p.message))
    ).toBe(true)
    vi.stubEnv('TENANT_ISOLATION_MODE', 'enforce')
    expect(
      collectEnvProblems(baseEnv()).some((p) => p.fatal && /TENANT_ISOLATION_MODE/.test(p.message))
    ).toBe(false)
  })

  it('retention below 6 years is fatal', () => {
    vi.stubEnv('AUDIT_RETENTION_YEARS', '5')
    expect(
      collectEnvProblems(baseEnv()).some((p) => p.fatal && /AUDIT_RETENTION_YEARS/.test(p.message))
    ).toBe(true)
  })

  it('in production the process exits; outside production it only warns', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.stubEnv('TENANT_ISOLATION_MODE', 'off')
    vi.stubEnv('NODE_ENV', 'production')
    validateProductionEnv()
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockClear()
    vi.stubEnv('NODE_ENV', 'development')
    validateProductionEnv()
    expect(exit).not.toHaveBeenCalled()
  })
})

describe('B0.3.5 PHI scrubbing', () => {
  const PHI = {
    name: 'Jane Realname',
    email: 'jane.realname@clinic-mail.example',
    phone: '(416) 555-0199',
    transcript: 'Patient reports chest pain since Monday',
  }

  it('scrubs PHI keys deep in objects and PHI patterns in free text', () => {
    const out = JSON.stringify(scrubPhi({ ctx: { patient: PHI, id: 'cmabc123' } }))
    for (const v of Object.values(PHI)) expect(out).not.toContain(v)
    expect(out).toContain('cmabc123')
    expect(
      scrubText('lookup failed for jane.realname@clinic-mail.example / 416-555-0199 / 900-12-3456')
    ).toBe('lookup failed for [EMAIL] / [PHONE] / [SSN]')
    expect(
      scrubText('Invalid `prisma.user.create()`: { name: "Jane Realname", email: "x" }')
    ).not.toContain('Jane')
    expect(scrubUrl('/public/patients/check?email=jane@x.test&clinicId=c1')).toBe(
      '/public/patients/check?email=[REDACTED]&clinicId=[REDACTED]'
    )
  })

  it('an error carrying PHI in its message, stack and context is logged without it', () => {
    const writes: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    })
    // Shape of a real Prisma error: it echoes the query arguments.
    const err = new Error(
      `Invalid \`prisma.user.create()\` invocation:
{ data: { name: "${PHI.name}", email: "${PHI.email}", phone: "${PHI.phone}" } }`
    )
    logError(err, { patient: PHI, note: 'BP 180/110, prescribed lisinopril' })
    const logged = writes.join('')
    expect(logged.length).toBeGreaterThan(0)
    for (const v of [...Object.values(PHI), 'lisinopril']) expect(logged).not.toContain(v)
  })

  it('console.* output is scrubbed once the console scrubber is installed', () => {
    const lines: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void lines.push(args)
    try {
      installConsoleScrubber()
      console.error('failed for', PHI)
      expect(JSON.stringify(lines)).not.toMatch(/Jane|clinic-mail|chest pain/)
    } finally {
      console.error = original
    }
  })

  it('a 500 in production returns a generic message (no internals echoed to the client)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    let payload: Record<string, unknown> = {}
    const res = {
      status: () => res,
      json: (body: Record<string, unknown>) => {
        payload = body
        return res
      },
    } as unknown as Response
    errorHandler(
      new Error(`Invalid prisma call with email ${PHI.email}`),
      { path: '/x', method: 'GET' } as Request,
      res,
      () => {}
    )
    expect(payload.message).toBe('Internal Server Error')
    expect(JSON.stringify(payload)).not.toContain(PHI.email)
  })

  it('security alert payloads are scrubbed before they leave the process', async () => {
    resetSecurityMonitor()
    vi.stubEnv('ALERT_WEBHOOK_URL', 'https://hooks.example.test/x')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    raiseAlert('failed_auth_spike', `spike from ${PHI.email}`, { ip: '10.0.0.1', note: PHI.name })
    await new Promise((r) => setTimeout(r, 0))
    const body = String(fetchMock.mock.calls[0]?.[1]?.body)
    expect(body).toContain('failed_auth_spike')
    expect(body).not.toContain(PHI.email)
    expect(body).not.toContain(PHI.name)
    vi.unstubAllGlobals()
  })
})

describe('B0.2.2 TOTP (RFC 6238 vector)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  it('matches the published SHA-1 vectors (last 6 digits)', () => {
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082')
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804')
    expect(totpAt(secret, Math.floor(1234567890 / 30))).toBe('005924')
  })
  it('accepts ±1 step of skew, rejects older codes and malformed input', () => {
    const now = 1234567890 * 1000
    expect(verifyTotp(secret, totpAt(secret, Math.floor(1234567890 / 30) - 1), now)).not.toBeNull()
    expect(verifyTotp(secret, totpAt(secret, Math.floor(1234567890 / 30) - 3), now)).toBeNull()
    expect(verifyTotp(secret, '12ab56', now)).toBeNull()
  })
})

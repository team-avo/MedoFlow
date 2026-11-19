/**
 * CTO-38: the Cloudflare Pages custom-domain provider against a stubbed
 * Cloudflare API and stubbed DNS. Nothing leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PagesDomainProvider, RETRY_EVERY_MS, isCapacityError } from '../site/domainProvider/pages'
import { PagesError } from '../site/frontDoor/cfApi'
import type { DnsResolver } from '../site/domainProvider/diagnose'

const TOKEN = 'cf-pages-secret-token'
const cfg = { token: TOKEN, accountId: 'acct1', project: 'medoflow' }
const host = 'www.clinic.example'
const input = { hostname: host, verifyToken: 'tok123', providerRef: host }
const BASE = 'https://api.cloudflare.com/client/v4/accounts/acct1/pages/projects/medoflow/domains'

const nodata = () => Promise.reject(new Error('ENODATA'))
const goodDns: DnsResolver = {
  resolveTxt: () => Promise.resolve([['medoflow-verify=tok123']]),
  resolveCname: (n) => (n === host ? Promise.resolve(['medoflow.pages.dev']) : nodata()),
  resolve4: nodata,
}
const noDns: DnsResolver = { resolveTxt: nodata, resolveCname: nodata, resolve4: nodata }

type Call = { url: string; method: string; body?: string }
let calls: Call[]
const reply = (result: unknown, status = 200, message?: string) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        success: status < 400,
        errors: status < 400 ? [] : [{ message: message ?? 'bad' }],
        result,
      }),
      { status }
    )
  )

function make(
  responder: (c: Call) => Promise<Response>,
  opts: { dns?: DnsResolver; now?: Date } = {}
) {
  return new PagesDomainProvider(cfg, {
    dns: opts.dns ?? goodDns,
    now: () => opts.now ?? new Date('2026-11-17T10:00:00Z'),
    fetch: ((url: string, init?: RequestInit) => {
      const c = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      }
      calls.push(c)
      return responder(c)
    }) as typeof fetch,
  })
}

beforeEach(() => {
  calls = []
  vi.stubEnv('SITE_CNAME_TARGET', '')
  vi.stubEnv('DOMAIN_PROVIDER', 'pages')
})
afterEach(() => vi.unstubAllEnvs())

describe('register', () => {
  it('adds the domain to the Pages project and returns the CNAME + TXT records', async () => {
    const p = make(() => reply({ id: 'd1', name: host, status: 'initializing' }))
    const r = await p.register(input)
    expect(calls).toEqual([{ url: BASE, method: 'POST', body: JSON.stringify({ name: host }) }])
    expect(r.providerRef).toBe('d1')
    expect(r.sslStatus).toBe('pending')
    expect(r.records).toEqual([
      { type: 'CNAME', name: host, value: 'medoflow.pages.dev', purpose: 'routing' },
      {
        type: 'TXT',
        name: `_medoflow-verify.${host}`,
        value: 'medoflow-verify=tok123',
        purpose: 'ownership',
      },
    ])
  })

  it('is idempotent: an existing domain is fetched, not added twice', async () => {
    const p = make((c) =>
      c.method === 'POST'
        ? reply(null, 409, 'Custom domain already exists')
        : reply({ id: 'd1', name: host, status: 'active' })
    )
    const r = await p.register(input)
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET'])
    expect(calls[1]!.url).toBe(`${BASE}/${host}`)
    expect(r.sslStatus).toBe('active')
  })

  it('the project-full answer is a capacity error; the token never appears in errors', async () => {
    const p = make(() =>
      reply(null, 400, 'You have reached the maximum number of custom domains for this project')
    )
    const err = await p.register(input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PagesError)
    expect(isCapacityError(err)).toBe(true)
    expect(String((err as Error).message)).not.toContain(TOKEN)
    expect(isCapacityError(new PagesError('bad hostname', 400))).toBe(false)
  })
})

describe('check', () => {
  it('DNS not ready → FAILED with the DNS message, Cloudflare is not called', async () => {
    const r = await make(() => reply({}), { dns: noDns }).check(input)
    expect(r.status).toBe('FAILED')
    expect(r.error).toMatch(/TXT record _medoflow-verify\.www\.clinic\.example not found yet/)
    expect(r.checks?.length).toBeGreaterThanOrEqual(2)
    expect(calls).toEqual([])
  })

  it('DNS right, certificate pending → VERIFIED + ssl pending', async () => {
    const r = await make(() =>
      reply({ name: host, status: 'pending', validation_data: { status: 'pending' } })
    ).check(input)
    expect(r).toMatchObject({ status: 'VERIFIED', sslStatus: 'pending', retried: false })
    expect(r.error).toMatch(/issuing the HTTPS certificate/)
  })

  it('active → VERIFIED + ssl active', async () => {
    const r = await make(() => reply({ name: host, status: 'active' })).check(input)
    expect(r).toMatchObject({ status: 'VERIFIED', sslStatus: 'active', error: null })
  })

  it('blocked → ssl blocked with Cloudflare’s reason', async () => {
    const r = await make(() =>
      reply({ name: host, status: 'blocked', verification_data: { error_message: 'abuse' } })
    ).check(input)
    expect(r.sslStatus).toBe('blocked')
    expect(r.error).toMatch(/Cloudflare blocked www\.clinic\.example: abuse/)
  })

  it('error → retries validation (PATCH), at most every 10 minutes', async () => {
    const responder = (c: Call) =>
      c.method === 'PATCH'
        ? reply({ name: host, status: 'pending' })
        : reply({
            name: host,
            status: 'error',
            validation_data: { error_message: 'CNAME missing' },
          })
    const now = new Date('2026-11-17T10:00:00Z')
    const first = await make(responder, { now }).check({ ...input, lastRetryAt: null })
    expect(first.retried).toBe(true)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(first.error).toBe('Cloudflare: CNAME missing')

    calls = []
    const recent = new Date(now.getTime() - RETRY_EVERY_MS + 1000)
    const second = await make(responder, { now }).check({ ...input, lastRetryAt: recent })
    expect(second.retried).toBe(false)
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('a domain missing on Cloudflare is added again', async () => {
    const r = await make((c) =>
      c.method === 'GET'
        ? reply(null, 404, 'not found')
        : reply({ name: host, status: 'initializing' })
    ).check(input)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(r.status).toBe('VERIFIED')
  })
})

describe('remove', () => {
  it('deletes the domain; a 404 is fine', async () => {
    await make(() => reply({})).remove(input)
    expect(calls).toEqual([{ url: `${BASE}/${host}`, method: 'DELETE', body: undefined }])
    await expect(make(() => reply(null, 404, 'gone')).remove(input)).resolves.toBeUndefined()
    await expect(make(() => reply(null, 500, 'boom')).remove(input)).rejects.toThrow('boom')
  })
})

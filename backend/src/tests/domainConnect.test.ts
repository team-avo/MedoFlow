/**
 * CTO-38 AC3: Domain Connect discovery, the SSRF guard on the untrusted
 * discovery host, signed apply URLs, the CSRF state, and the template file.
 * DNS and HTTP are stubs.
 */
import crypto from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildApplyUrl,
  clearDomainConnectCache,
  connectState,
  discover,
  domainConnectConfig,
  verifyConnectState,
  type DomainConnectConfig,
} from '../site/domainConnect'
import { isPublicAddress, safeGetJson, UnsafeUrlError } from '../site/domainConnect/safeFetch'
import type { DnsResolver } from '../site/domainProvider/diagnose'

const ZONE = 'clinic.example'
const nodata = () => Promise.reject(new Error('ENODATA'))
const dns = (txtHost: string | null): DnsResolver => ({
  resolveTxt: (n) =>
    n === `_domainconnect.${ZONE}` && txtHost ? Promise.resolve([[txtHost]]) : nodata(),
  resolveCname: nodata,
  resolve4: nodata,
})
const publicLookup = () => Promise.resolve([{ address: '93.184.216.34' }])
const cfg: DomainConnectConfig = {
  providerId: 'medoflow.example',
  serviceId: 'clinic-site',
  privateKey: null,
  keyHost: null,
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

let urls: string[]
function fakeFetch(templateStatus = 200) {
  return ((url: string) => {
    urls.push(url)
    if (url.endsWith(`/v2/${ZONE}/settings`)) {
      return json({
        providerId: 'godaddy.com',
        providerName: 'GoDaddy',
        providerDisplayName: 'GoDaddy',
        urlSyncUX: 'https://dcc.godaddy.example',
        urlAPI: 'https://api.godaddy.example',
      })
    }
    if (url.includes('/v2/domainTemplates/providers/medoflow.example/services/clinic-site')) {
      return json({}, templateStatus)
    }
    return json({}, 404)
  }) as typeof fetch
}

beforeEach(() => {
  urls = []
  clearDomainConnectCache()
})
afterEach(() => vi.unstubAllEnvs())

describe('config', () => {
  it('is off until DOMAIN_CONNECT_PROVIDER_ID is set', async () => {
    vi.stubEnv('DOMAIN_CONNECT_PROVIDER_ID', '')
    expect(domainConnectConfig()).toBeNull()
    expect(await discover(ZONE)).toEqual({ available: false, reason: 'not_configured' })
    vi.stubEnv('DOMAIN_CONNECT_PROVIDER_ID', 'medoflow.example')
    vi.stubEnv('DOMAIN_CONNECT_PRIVATE_KEY', '-----BEGIN-----\\nabc\\n-----END-----')
    expect(domainConnectConfig()).toMatchObject({
      providerId: 'medoflow.example',
      serviceId: 'clinic-site',
      privateKey: '-----BEGIN-----\nabc\n-----END-----',
    })
  })
})

describe('discovery', () => {
  it('TXT → settings → template check: available, with the provider’s name', async () => {
    const r = await discover(ZONE, {
      config: cfg,
      dns: dns('domainconnect.godaddy.example'),
      fetch: fakeFetch(),
      lookup: publicLookup,
    })
    expect(r).toEqual({
      available: true,
      provider: {
        providerId: 'godaddy.com',
        providerName: 'GoDaddy',
        urlSyncUX: 'https://dcc.godaddy.example',
        urlAPI: 'https://api.godaddy.example',
      },
    })
    expect(urls).toEqual([
      'https://domainconnect.godaddy.example/v2/clinic.example/settings',
      'https://api.godaddy.example/v2/domainTemplates/providers/medoflow.example/services/clinic-site',
    ])
  })

  it('no _domainconnect record → not supported (no HTTP at all)', async () => {
    const r = await discover(ZONE, { config: cfg, dns: dns(null), fetch: fakeFetch() })
    expect(r).toEqual({ available: false, reason: 'not_supported' })
    expect(urls).toEqual([])
  })

  it('template not onboarded (404) → template_missing', async () => {
    const r = await discover(ZONE, {
      config: cfg,
      dns: dns('domainconnect.godaddy.example'),
      fetch: fakeFetch(404),
      lookup: publicLookup,
    })
    expect(r).toEqual({ available: false, reason: 'template_missing' })
  })

  it('a discovery host on a private address is refused (SSRF guard)', async () => {
    const r = await discover(ZONE, {
      config: cfg,
      dns: dns('internal.clinic.example'),
      fetch: fakeFetch(),
      lookup: () => Promise.resolve([{ address: '10.0.0.5' }]),
    })
    expect(r).toEqual({ available: false, reason: 'not_supported' })
    expect(urls).toEqual([])
  })

  it('results are cached per zone', async () => {
    const deps = {
      config: cfg,
      dns: dns('domainconnect.godaddy.example'),
      fetch: fakeFetch(),
      lookup: publicLookup,
    }
    await discover(ZONE, deps)
    await discover(ZONE, deps)
    expect(urls.length).toBe(2)
  })
})

describe('safeGetJson', () => {
  const ok = (() => json({ a: 1 })) as typeof fetch
  it.each([
    ['http://dc.example/x', /https only/],
    ['https://93.184.216.34/x', /IP addresses/],
    ['https://[::1]/x', /IP addresses/],
    ['https://user:pw@dc.example/x', /credentials/],
    ['https://dc.example:8443/x', /port/],
    ['not a url', /not a URL/],
  ])('refuses %s', async (url, why) => {
    await expect(safeGetJson(url, { fetch: ok, lookup: publicLookup })).rejects.toThrow(why)
  })

  it('refuses hosts that resolve to private, loopback, link-local or CGNAT addresses', async () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
    ]) {
      await expect(
        safeGetJson('https://dc.example/x', {
          fetch: ok,
          lookup: () => Promise.resolve([{ address }]),
        }),
        address
      ).rejects.toBeInstanceOf(UnsafeUrlError)
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false)
  })

  it('does not follow redirects and caps the body', async () => {
    const redirect = (() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
      )) as typeof fetch
    await expect(
      safeGetJson('https://dc.example/x', { fetch: redirect, lookup: publicLookup })
    ).rejects.toThrow(/redirects/)
    const huge = (() =>
      Promise.resolve(new Response('x'.repeat(40 * 1024), { status: 200 }))) as typeof fetch
    await expect(
      safeGetJson('https://dc.example/x', { fetch: huge, lookup: publicLookup })
    ).rejects.toThrow(/too large/)
    expect(await safeGetJson('https://dc.example/x', { fetch: ok, lookup: publicLookup })).toEqual({
      status: 200,
      json: { a: 1 },
    })
  })
})

describe('apply URL', () => {
  const provider = {
    providerId: 'godaddy.com',
    providerName: 'GoDaddy',
    urlSyncUX: 'https://dcc.godaddy.example/',
    urlAPI: 'https://api.godaddy.example',
  }
  const base = {
    provider,
    zone: ZONE,
    host: 'www',
    target: 'medoflow.pages.dev',
    token: 'tok123',
    redirectUri: 'https://medoflow.pages.dev/dashboard/site/domains?dc=d1',
    state: 'st',
  }

  it('carries the template variables, redirect and state', () => {
    const url = new URL(buildApplyUrl({ ...base, config: cfg }))
    expect(url.origin + url.pathname).toBe(
      'https://dcc.godaddy.example/v2/domainTemplates/providers/medoflow.example/services/clinic-site/apply'
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      domain: ZONE,
      host: 'www',
      target: 'medoflow.pages.dev',
      token: 'tok123',
      redirect_uri: 'https://medoflow.pages.dev/dashboard/site/domains?dc=d1',
      state: 'st',
    })
  })

  it('is signed with RS256 over the query string (verifiable with the public key)', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const url = buildApplyUrl({ ...base, config: { ...cfg, privateKey: pem, keyHost: '_dck1' } })
    const query = url.split('?')[1]!
    const [unsigned, rest] = query.split('&key=')
    const [key, sigPart] = rest!.split('&sig=')
    expect(key).toBe('_dck1')
    const sig = Buffer.from(decodeURIComponent(sigPart!), 'base64')
    expect(crypto.verify('sha256', Buffer.from(unsigned!), publicKey, sig)).toBe(true)
    expect(crypto.verify('sha256', Buffer.from(`${unsigned}x`), publicKey, sig)).toBe(false)
  })

  it('state is bound to the domain', () => {
    const s = connectState('d1')
    expect(verifyConnectState('d1', s)).toBe(true)
    expect(verifyConnectState('d2', s)).toBe(false)
    expect(verifyConnectState('d1', 'x'.repeat(32))).toBe(false)
    expect(verifyConnectState('d1', undefined)).toBe(false)
  })
})

describe('the template file', () => {
  it('creates exactly the CNAME and TXT the Domains screen asks for', () => {
    const file = path.resolve(
      __dirname,
      '../../../docs/domain-connect/medoflow.example.clinic-site.json'
    )
    const t = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> & {
      records: Array<Record<string, unknown>>
    }
    for (const k of ['providerId', 'providerName', 'serviceId', 'serviceName', 'records']) {
      expect(t[k], k).toBeTruthy()
    }
    expect(t.serviceId).toBe('clinic-site')
    expect(t.hostRequired).toBe(true)
    expect(t.syncPubKeyDomain).toBeTruthy()
    expect(t.records).toEqual([
      expect.objectContaining({ type: 'CNAME', host: '@', pointsTo: '%target%' }),
      expect.objectContaining({
        type: 'TXT',
        host: '_medoflow-verify',
        data: 'medoflow-verify=%token%',
      }),
    ])
  })
})

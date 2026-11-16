/**
 * CTO-38: guided custom-domain connect against Postgres (enforce + RLS).
 * The provider behaves like DOMAIN_PROVIDER=pages (stub); DNS, the HTTPS
 * probe and Domain Connect discovery are stubs. Nothing leaves the machine.
 *
 * Covers: stages dns → verified → ssl → live without anyone pressing Verify
 * (poll + cron), poll throttling, audits only on stage changes, primary only
 * once live, apex refusal, background checks never take a live domain
 * offline, Domain Connect availability + signed return, access rules, and
 * off-boarding removing the domain from the provider.
 */
import crypto from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import {
  setDomainProviderForTests,
  type DomainCheck,
  type DomainProvider,
} from '../../site/domainProvider'
import { setDnsResolverForTests, type DnsResolver } from '../../site/domainProvider/diagnose'
import { setHttpsProbeForTests } from '../../site/domainProvider/probe'
import { invalidateHostCache } from '../../site/services/hostService'
import { recheckDomains } from '../../site/services/domainService'
import { clearDomainConnectCache, connectState } from '../../site/domainConnect'
import { withTenantBypass } from '../../config/tenantContext'
import { offboardTenant } from '../../services/dataLifecycleService'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let C: ClinicFixture
const t = {} as Record<'aAdmin' | 'aFrontDesk' | 'bAdmin' | 'cAdmin', string>

/** What "Cloudflare" and "DNS" say about each hostname right now. */
const dnsReady = new Set<string>()
const certActive = new Set<string>()
const serving = new Set<string>()
const removed: string[] = []
const checkCalls: string[] = []

const stub: DomainProvider = {
  name: 'pages',
  register: (input) =>
    Promise.resolve({
      providerRef: input.hostname,
      records: [
        { type: 'CNAME', name: input.hostname, value: 'medoflow.pages.dev', purpose: 'routing' },
        {
          type: 'TXT',
          name: `_medoflow-verify.${input.hostname}`,
          value: `medoflow-verify=${input.verifyToken}`,
          purpose: 'ownership',
        },
      ],
      sslStatus: 'pending',
    }),
  check: (input): Promise<DomainCheck> => {
    checkCalls.push(input.hostname)
    const checks = [
      {
        type: 'CNAME' as const,
        name: input.hostname,
        purpose: 'routing' as const,
        ok: dnsReady.has(input.hostname),
        found: dnsReady.has(input.hostname) ? ['medoflow.pages.dev'] : ['parked.example'],
        message: dnsReady.has(input.hostname)
          ? null
          : `CNAME ${input.hostname} points to parked.example, expected medoflow.pages.dev`,
      },
    ]
    if (!dnsReady.has(input.hostname)) {
      return Promise.resolve({
        status: 'FAILED',
        sslStatus: null,
        records: [],
        error: checks[0]!.message,
        checks,
      })
    }
    return Promise.resolve({
      status: 'VERIFIED',
      sslStatus: certActive.has(input.hostname) ? 'active' : 'pending',
      records: [],
      error: certActive.has(input.hostname) ? null : 'Cloudflare is issuing the HTTPS certificate',
      checks,
    })
  },
  remove: (input) => {
    removed.push(input.hostname)
    return Promise.resolve()
  },
}

const nodata = () => Promise.reject(new Error('ENODATA'))
const ZONE_A = `dc-a-${crypto.randomBytes(3).toString('hex')}.example`
const dns: DnsResolver = {
  // Every test zone runs on GoDaddy and advertises Domain Connect.
  resolveNs: (n) =>
    n.endsWith('.example') && n.split('.').length === 2
      ? Promise.resolve(['ns51.domaincontrol.com', 'ns52.domaincontrol.com'])
      : nodata(),
  resolveTxt: (n) =>
    n.startsWith('_domainconnect.') ? Promise.resolve([['dc.godaddy.example']]) : nodata(),
  resolveCname: nodata,
  resolve4: nodata,
}

const status = (token: string, id: string) =>
  api(server.url, `/site/domains/${id}/status`, { token })

beforeAll(async () => {
  setDomainProviderForTests(stub)
  setDnsResolverForTests(dns)
  setHttpsProbeForTests((host) =>
    Promise.resolve(
      serving.has(host) ? { ok: true, detail: 'ok' } : { ok: false, detail: 'not yet' }
    )
  )
  server = await startServer()
  A = await createClinicFixture('dc-a')
  B = await createClinicFixture('dc-b')
  C = await createClinicFixture('dc-c')
  for (const f of [A, B, C]) {
    await adminDb.tenant.update({ where: { id: f.tenantId }, data: { plan: 'STARTER' } })
  }
  t.aAdmin = (await login(server.url, A.users.admin.email)).accessToken
  t.aFrontDesk = (await login(server.url, A.users.frontDesk.email)).accessToken
  t.bAdmin = (await login(server.url, B.users.admin.email)).accessToken
  t.cAdmin = (await login(server.url, C.users.admin.email)).accessToken
})
afterAll(async () => {
  setDomainProviderForTests(null)
  setDnsResolverForTests(null)
  setHttpsProbeForTests(null)
  clearDomainConnectCache()
  invalidateHostCache()
  await server.close()
})

describe('guided connect: detection and records', () => {
  it('detects the zone and DNS provider and gives zone-relative hosts', async () => {
    const res = await api(server.url, '/site/domains', {
      token: t.aAdmin,
      body: { hostname: `www.${ZONE_A}` },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data).toMatchObject({
      hostname: `www.${ZONE_A}`,
      status: 'PENDING',
      stage: 'dns',
      zone: ZONE_A,
      dnsProvider: { key: 'godaddy', name: 'GoDaddy' },
    })
    expect(
      res.body.data.records.map((r: { type: string; host: string }) => [r.type, r.host])
    ).toEqual([
      ['CNAME', 'www'],
      ['TXT', '_medoflow-verify.www'],
    ])
  })

  it('a root domain is refused with the www alternative (Pages needs a sub-domain)', async () => {
    const res = await api(server.url, '/site/domains', {
      token: t.aAdmin,
      body: { hostname: ZONE_A },
    })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('site_domain_apex')
    expect(res.body.message).toContain(`www.${ZONE_A}`)
  })
})

describe('guided connect: stages move on their own', () => {
  const host = `www.${ZONE_A}`
  let id: string

  beforeAll(async () => {
    const row = await adminDb.siteDomain.findUniqueOrThrow({ where: { hostname: host } })
    id = row.id
  })

  it('a poll reports per-record problems in plain language', async () => {
    const res = await status(t.aAdmin, id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ stage: 'dns', status: 'FAILED' })
    expect(res.body.data.lastError).toBe(
      `CNAME ${host} points to parked.example, expected medoflow.pages.dev`
    )
    expect(res.body.data.checks[0]).toMatchObject({ type: 'CNAME', ok: false })
  })

  it('polls are throttled: one real check per 15 s per domain', async () => {
    const before = checkCalls.length
    await status(t.aAdmin, id)
    await status(t.aAdmin, id)
    expect(checkCalls.length).toBe(before)
  })

  it('the 5-minute background re-check moves dns → verified → ssl → live with nobody watching', async () => {
    const run = () => withTenantBypass('test:domain-recheck', () => recheckDomains())
    const stageOf = async () =>
      (await adminDb.siteDomain.findUniqueOrThrow({ where: { id } })).stage

    dnsReady.add(host)
    expect(await run()).toBeGreaterThanOrEqual(1)
    expect(await stageOf()).toBe('verified')

    // Making it primary is refused until HTTPS works.
    const early = await api(server.url, `/site/domains/${id}/primary`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(early.status).toBe(409)
    expect(early.body.code).toBe('site_domain_not_live')

    certActive.add(host)
    await run()
    expect(await stageOf()).toBe('ssl')

    serving.add(host)
    await run()
    const live = await adminDb.siteDomain.findUniqueOrThrow({ where: { id } })
    expect(live).toMatchObject({ stage: 'live', status: 'VERIFIED', lastError: null })
    expect(live.liveAt).toBeTruthy()

    // A live domain is no longer in the "connecting" batch.
    const callsBefore = checkCalls.length
    await run()
    expect(checkCalls.slice(callsBefore)).not.toContain(host)
  })

  it('stage changes are audited once each (system rows), polls write no noise', async () => {
    const rows = await adminDb.auditLog.findMany({
      where: { clinicId: A.clinicId, entityType: 'SiteDomain', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, newValue: true, performedById: true },
    })
    const stages = rows
      .filter((r) => r.action === 'SITE_DOMAIN_STAGE')
      .map((r) => (r.newValue as { stage: string }).stage)
    expect(stages).toEqual(['verified', 'ssl', 'live'])
    expect(rows.filter((r) => r.action === 'SITE_DOMAIN_LIVE')).toHaveLength(1)
    expect(rows.find((r) => r.action === 'SITE_DOMAIN_LIVE')?.performedById).toBeNull()
    expect(rows.filter((r) => r.action === 'SITE_DOMAIN_CHECK_FAILED')).toHaveLength(0)
  })

  it('once live it can be primary, and serves the clinic site', async () => {
    const res = await api(server.url, `/site/domains/${id}/primary`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const resolved = await api(server.url, `/public/sites/resolve?host=${host}`)
    expect(resolved.body.data).toMatchObject({ kind: 'site' })
  })

  it('a background check that sees broken DNS never takes a live domain offline', async () => {
    dnsReady.delete(host)
    await withTenantBypass('test:domain-drift', () => recheckDomains({ live: true }))
    const row = await adminDb.siteDomain.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ status: 'VERIFIED', stage: 'live' })
    expect(row.lastError).toMatch(/no longer looks right/)
    invalidateHostCache()
    expect((await api(server.url, `/public/sites/resolve?host=${host}`)).body.data.kind).toBe(
      'site'
    )
    const drift = await adminDb.auditLog.count({
      where: { clinicId: A.clinicId, entityId: id, action: 'SITE_DOMAIN_DRIFT' },
    })
    expect(drift).toBe(1)
    dnsReady.add(host)
  })
})

describe('Domain Connect (one click)', () => {
  const zone = `dc-b-${crypto.randomBytes(3).toString('hex')}.example`
  let id: string

  beforeAll(async () => {
    const res = await api(server.url, '/site/domains', {
      token: t.bAdmin,
      body: { hostname: `www.${zone}` },
    })
    id = res.body.data.id
  })

  it('is unavailable (not_configured) until DOMAIN_CONNECT_PROVIDER_ID is set', async () => {
    delete process.env.DOMAIN_CONNECT_PROVIDER_ID
    const res = await api(server.url, `/site/domains/${id}/connect`, { token: t.bAdmin })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ available: false, reason: 'not_configured' })
  })

  it('a provider that has not onboarded the template stays manual', async () => {
    process.env.DOMAIN_CONNECT_PROVIDER_ID = 'medoflow.example'
    clearDomainConnectCache()
    // The discovery host does not resolve in tests: not_supported, never an error.
    const res = await api(server.url, `/site/domains/${id}/connect`, { token: t.bAdmin })
    expect(res.status).toBe(200)
    expect(res.body.data.available).toBe(false)
    delete process.env.DOMAIN_CONNECT_PROVIDER_ID
  })

  it('the return from the DNS provider needs the signed state, then re-checks at once', async () => {
    const bad = await api(server.url, `/site/domains/${id}/connect/return`, {
      token: t.bAdmin,
      body: { state: 'x'.repeat(32) },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('site_connect_state')

    dnsReady.add(`www.${zone}`)
    const before = checkCalls.length
    const ok = await api(server.url, `/site/domains/${id}/connect/return`, {
      token: t.bAdmin,
      body: { state: connectState(id), error: 'access_denied' },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ stage: 'verified', connectError: 'access_denied' })
    expect(checkCalls.length).toBe(before + 1)
    const audit = await adminDb.auditLog.count({
      where: { clinicId: B.clinicId, entityId: id, action: 'SITE_DOMAIN_CONNECT_RETURN' },
    })
    expect(audit).toBe(1)
  })
})

describe('access', () => {
  it('only the owning clinic’s owner can poll or connect', async () => {
    const row = await adminDb.siteDomain.findFirstOrThrow({
      where: { clinicId: A.clinicId, kind: 'CUSTOM' },
    })
    expect((await status(t.bAdmin, row.id)).status).toBe(404)
    expect((await status(t.aFrontDesk, row.id)).status).toBe(403)
    expect(
      (await api(server.url, `/site/domains/${row.id}/connect`, { token: t.bAdmin })).status
    ).toBe(404)
    expect(
      (
        await api(server.url, `/site/domains/${row.id}/connect/return`, {
          token: t.bAdmin,
          body: { state: connectState(row.id) },
        })
      ).status
    ).toBe(404)
  })
})

describe('off-boarding', () => {
  it('removes the clinic’s domains from the provider', async () => {
    const host = `www.dc-c-${crypto.randomBytes(3).toString('hex')}.example`
    const res = await api(server.url, '/site/domains', {
      token: t.cAdmin,
      body: { hostname: host },
    })
    expect(res.status).toBe(201)
    const tenant = await adminDb.tenant.findUniqueOrThrow({ where: { id: C.tenantId } })
    await offboardTenant(C.tenantId, { confirmSlug: tenant.slug, performedById: C.users.admin.id })
    expect(removed).toContain(host)
    expect(await adminDb.siteDomain.count({ where: { hostname: host } })).toBe(0)
  })
})

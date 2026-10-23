/**
 * Component 8 / B8.2 — clinic subdomains, custom domains and host routing,
 * against Postgres (enforce + RLS). SITE_ROOT_DOMAIN=site.test (setup.ts);
 * the DNS provider is stubbed so verification is deterministic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import {
  setDomainProviderForTests,
  type DomainProvider,
  type DomainCheck,
} from '../../site/domainProvider'
import { invalidateHostCache } from '../../site/services/hostService'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let slugA: string
const t = {} as Record<'aAdmin' | 'aFrontDesk' | 'bAdmin', string>

/** Verifies a domain once `dnsReady` contains it (stands in for real DNS). */
const dnsReady = new Set<string>()
const stub: DomainProvider = {
  name: 'manual',
  register: (input) =>
    Promise.resolve({
      providerRef: null,
      records: [
        { type: 'CNAME', name: input.hostname, value: 'sites.site.test', purpose: 'routing' },
        {
          type: 'TXT',
          name: `_medoflow-verify.${input.hostname}`,
          value: `medoflow-verify=${input.verifyToken}`,
          purpose: 'ownership',
        },
      ],
      sslStatus: null,
    }),
  check: (input): Promise<DomainCheck> =>
    Promise.resolve(
      dnsReady.has(input.hostname)
        ? { status: 'VERIFIED', sslStatus: 'active', records: [], error: null }
        : { status: 'FAILED', sslStatus: null, records: [], error: 'TXT record not found yet' }
    ),
  remove: () => Promise.resolve(),
}

beforeAll(async () => {
  setDomainProviderForTests(stub)
  server = await startServer()
  A = await createClinicFixture('dom-a')
  B = await createClinicFixture('dom-b')
  t.aAdmin = (await login(server.url, A.users.admin.email)).accessToken
  t.aFrontDesk = (await login(server.url, A.users.frontDesk.email)).accessToken
  t.bAdmin = (await login(server.url, B.users.admin.email)).accessToken
  slugA = (await adminDb.clinic.findUniqueOrThrow({ where: { id: A.clinicId } })).slug!
  // Publish a home page for A.
  await api(server.url, '/site/templates/vitality/install', {
    token: t.aAdmin,
    body: { mode: 'replace' },
  })
  await api(server.url, '/site/publish', { token: t.aAdmin, body: { pageIds: 'all' } })
})
afterAll(async () => {
  setDomainProviderForTests(null)
  invalidateHostCache()
  await server.close()
})

const render = (q: Record<string, string>) =>
  api(server.url, `/public/sites/render?${new URLSearchParams(q).toString()}`)
const resolve = (host: string) =>
  api(server.url, `/public/sites/resolve?host=${encodeURIComponent(host)}`)

describe('clinic subdomains', () => {
  it('every clinic gets <slug>.<root>; it resolves and renders that clinic’s branded site', async () => {
    const d = await api(server.url, '/site/domains', { token: t.aAdmin })
    expect(d.status).toBe(200)
    expect(d.body.data.rootDomain).toBe('site.test')
    const sub = d.body.data.domains.find((x: { kind: string }) => x.kind === 'SUBDOMAIN')
    expect(sub).toMatchObject({
      hostname: `${slugA}.site.test`,
      status: 'VERIFIED',
      isPrimary: true,
    })

    const r = await resolve(`${slugA}.site.test`)
    expect(r.body.data).toMatchObject({ kind: 'site', clinicSlug: slugA })
    const page = await render({ host: `${slugA}.site.test:443`, path: '/' })
    expect(page.status).toBe(200)
    expect(page.body.data.site.clinicId).toBe(A.clinicId)
    expect(page.body.data.site.settings.theme.fontPair).toBe('bold') // vitality theme
    expect(page.body.data.site.canonicalBase).toBe(`https://${slugA}.site.test`)
  })

  it('unknown, reserved, nested and app hosts are not sites', async () => {
    for (const host of [
      'nobody-here.site.test',
      'www.site.test',
      'api.site.test',
      `a.${slugA}.site.test`,
      '10.0.0.1',
      'localhost',
    ]) {
      const res = await render({ host, path: '/' })
      expect(res.status, host).toBe(404)
      expect(res.body.code).toBe('site_unknown')
    }
    expect((await resolve('app.site.test')).body.data.kind).toBe('app')
    expect((await resolve('api.site.test')).body.data.kind).toBe('api')
  })

  it('the /s/<slug> path fallback 301s to the canonical subdomain', async () => {
    const res = await render({ clinic: slugA, path: '/team' })
    expect(res.body.data.redirect).toEqual({
      type: 'redirect',
      to: `https://${slugA}.site.test/team`,
      code: 301,
    })
  })

  it('an inactive clinic’s site goes dark', async () => {
    const res1 = await render({ host: `${slugA}.site.test`, path: '/' })
    expect(res1.status).toBe(200)
    await adminDb.clinic.update({ where: { id: A.clinicId }, data: { isActive: false } })
    invalidateHostCache()
    expect((await render({ host: `${slugA}.site.test`, path: '/' })).status).toBe(404)
    await adminDb.clinic.update({ where: { id: A.clinicId }, data: { isActive: true } })
    invalidateHostCache()
  })

  it('renaming the subdomain keeps the old one as a 301 alias', async () => {
    const res = await api(server.url, '/site/domains/subdomain', {
      token: t.aAdmin,
      method: 'PUT',
      body: { label: `${slugA}-new` },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const old = await render({ host: `${slugA}.site.test`, path: '/team' })
    expect(old.body.data.redirect).toMatchObject({
      to: `https://${slugA}-new.site.test/team`,
      code: 301,
    })
    expect((await render({ host: `${slugA}-new.site.test`, path: '/' })).status).toBe(200)
    // A label already in use elsewhere is refused.
    const slugB = (await adminDb.clinic.findUniqueOrThrow({ where: { id: B.clinicId } })).slug!
    await api(server.url, '/site/domains', { token: t.bAdmin }) // ensures B's subdomain exists
    expect(
      (
        await api(server.url, '/site/domains/subdomain', {
          token: t.aAdmin,
          method: 'PUT',
          body: { label: slugB },
        })
      ).status
    ).toBe(409)
    expect(
      (
        await api(server.url, '/site/domains/subdomain', {
          token: t.aAdmin,
          method: 'PUT',
          body: { label: 'admin' },
        })
      ).status
    ).toBe(409)
  })
})

describe('custom domains', () => {
  const host = `www.dom-a-${Date.now()}.example`

  it('are a paid feature', async () => {
    const res = await api(server.url, '/site/domains', {
      token: t.aAdmin,
      body: { hostname: host },
    })
    expect(res.status).toBe(402)
    expect(res.body.code).toBe('site_domain_plan')
    await adminDb.tenant.update({ where: { id: A.tenantId }, data: { plan: 'STARTER' } })
    await adminDb.tenant.update({ where: { id: B.tenantId }, data: { plan: 'STARTER' } })
  })

  it('refuses invalid, platform and root-domain hosts', async () => {
    for (const hostname of [
      'not a domain',
      '10.1.2.3',
      'x.site.test',
      'site.test',
      'mine.workers.dev',
      'thing.localhost',
      'nodot',
    ]) {
      const res = await api(server.url, '/site/domains', { token: t.aAdmin, body: { hostname } })
      expect(res.status, hostname).toBe(422)
    }
  })

  it('add → DNS records shown → does not serve until verified', async () => {
    const res = await api(server.url, '/site/domains', {
      token: t.aAdmin,
      body: { hostname: `HTTPS://${host.toUpperCase()}/` },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data).toMatchObject({ hostname: host, status: 'PENDING', kind: 'CUSTOM' })
    expect(res.body.data.records.map((r: { type: string }) => r.type)).toEqual(['CNAME', 'TXT'])
    expect((await render({ host, path: '/' })).status).toBe(404)

    // Another clinic can't claim it.
    expect(
      (await api(server.url, '/site/domains', { token: t.bAdmin, body: { hostname: host } })).status
    ).toBe(409)

    const id = res.body.data.id
    const notYet = await api(server.url, `/site/domains/${id}/verify`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(notYet.body.data).toMatchObject({
      status: 'FAILED',
      lastError: 'TXT record not found yet',
    })
    expect((await render({ host, path: '/' })).status).toBe(404)

    dnsReady.add(host)
    const ok = await api(server.url, `/site/domains/${id}/verify`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(ok.body.data.status).toBe('VERIFIED')
    // Verified but not primary: it 301s to the primary subdomain.
    const alias = await render({ host, path: '/contact' })
    expect(alias.body.data.redirect.to).toBe(`https://${slugA}-new.site.test/contact`)

    // Make it primary: it serves the site and everything else points at it.
    expect(
      (await api(server.url, `/site/domains/${id}/primary`, { token: t.aAdmin, method: 'POST' }))
        .status
    ).toBe(200)
    const served = await render({ host, path: '/' })
    expect(served.status).toBe(200)
    expect(served.body.data.site.canonicalBase).toBe(`https://${host}`)
    expect(
      (await render({ host: `${slugA}-new.site.test`, path: '/team' })).body.data.redirect.to
    ).toBe(`https://${host}/team`)
    expect((await render({ clinic: slugA, path: '/' })).body.data.redirect.to).toBe(
      `https://${host}/`
    )

    const audits = await adminDb.auditLog.findMany({
      where: { clinicId: A.clinicId, entityType: 'SiteDomain' },
      select: { action: true },
    })
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'SITE_DOMAIN_ADDED',
        'SITE_DOMAIN_CHECK_FAILED',
        'SITE_DOMAIN_VERIFIED',
        'SITE_DOMAIN_PRIMARY',
      ])
    )
  })

  it('only owners manage domains; other clinics cannot touch them', async () => {
    expect((await api(server.url, '/site/domains', { token: t.aFrontDesk })).status).toBe(403)
    const row = await adminDb.siteDomain.findFirstOrThrow({
      where: { clinicId: A.clinicId, kind: 'CUSTOM' },
    })
    expect(
      (await api(server.url, `/site/domains/${row.id}/verify`, { token: t.bAdmin, method: 'POST' }))
        .status
    ).toBe(404)
    expect(
      (await api(server.url, `/site/domains/${row.id}`, { token: t.bAdmin, method: 'DELETE' }))
        .status
    ).toBe(404)
  })

  it('removing the primary custom domain falls back to the subdomain', async () => {
    const row = await adminDb.siteDomain.findFirstOrThrow({
      where: { clinicId: A.clinicId, kind: 'CUSTOM' },
    })
    const res = await api(server.url, `/site/domains/${row.id}`, {
      token: t.aAdmin,
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect((await render({ host, path: '/' })).status).toBe(404)
    const page = await render({ host: `${slugA}-new.site.test`, path: '/' })
    expect(page.status).toBe(200)
    expect(page.body.data.site.canonicalBase).toBe(`https://${slugA}-new.site.test`)
    // Re-add + verify for the CORS checks below.
    const again = await api(server.url, '/site/domains', {
      token: t.aAdmin,
      body: { hostname: host },
    })
    await api(server.url, `/site/domains/${again.body.data.id}/verify`, {
      token: t.aAdmin,
      method: 'POST',
    })
  })
})

describe('CORS and transport security for clinic sites', () => {
  const preflight = (origin: string) =>
    fetch(`${server.url}/public/sites/leads`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })

  it('allows the app origin, live clinic subdomains and verified custom domains', async () => {
    const custom = await adminDb.siteDomain.findFirstOrThrow({
      where: { clinicId: A.clinicId, kind: 'CUSTOM', status: 'VERIFIED' },
    })
    for (const origin of [
      'http://localhost:3000',
      `https://${slugA}-new.site.test`,
      `https://${custom.hostname}`,
    ]) {
      const res = await preflight(origin)
      expect(res.headers.get('access-control-allow-origin'), origin).toBe(origin)
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    }
  })

  it('refuses unknown, look-alike, nested, non-https and unverified origins', async () => {
    await api(server.url, '/site/domains', {
      token: t.bAdmin,
      body: { hostname: 'pending-b.example' },
    })
    for (const origin of [
      'https://evil.example',
      'https://nobody-here.site.test',
      `https://a.${slugA}-new.site.test`,
      `http://${slugA}-new.site.test`,
      'https://evilsite.test',
      'https://pending-b.example',
      'https://localhost.evil.example',
    ]) {
      const res = await preflight(origin)
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull()
    }
  })

  it('every API response carries HSTS (1 year, subdomains)', async () => {
    const res = await fetch(`${server.url}/public/sites/resolve?host=${slugA}-new.site.test`)
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
  })
})

describe('new clinics get a site address at signup', () => {
  it('tenant signup sets the clinic slug and its subdomain', async () => {
    const sub = `signup${Date.now().toString(36)}`
    const res = await api(server.url, '/tenants/signup', {
      body: {
        clinicName: 'Synthetic Signup Clinic',
        clinicEmail: `clinic.${sub}@example.test`,
        subdomain: sub,
        ownerName: 'Owner Synthetic',
        ownerEmail: `owner.${sub}@example.test`,
        password: 'Synthetic-Signup-Pass-2026!',
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const clinic = await adminDb.clinic.findFirstOrThrow({ where: { slug: sub } })
    const d = await adminDb.siteDomain.findUniqueOrThrow({ where: { hostname: sub } })
    expect(d).toMatchObject({
      clinicId: clinic.id,
      kind: 'SUBDOMAIN',
      isPrimary: true,
      status: 'VERIFIED',
    })
    expect(
      (await api(server.url, `/tenants/check-subdomain?subdomain=${sub}`)).body.data.available
    ).toBe(false)
    expect(res.body.data.siteUrl).toBe(`https://${sub}.site.test`)
  })
})

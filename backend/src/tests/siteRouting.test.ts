/**
 * Component 8 units: the route registry and host classification (parity
 * with the frontend via shared/validation-cases), CORS matching, preview
 * tokens, domain providers, image sizing, lead spam filtering, the AI
 * prompt, link resolution and plan entitlements.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { matchSitePath } from '../site/routing/matchSitePath'
import { buildSitePath, withSiteBase } from '../site/routing/buildSitePath'
import { classifyHost } from '../site/routing/hosts'
import { SITE_ROUTE_KEYS, type SiteRouteKey } from '../site/routing/routeKeys'
import { parseSection, SECTION_SETTINGS } from '../site/content/sections'
import { matchesStaticPolicy, parseCorsOrigins } from '../site/cors'
import {
  createPreviewToken,
  verifyPreviewToken,
  PREVIEW_TTL_SECONDS,
} from '../site/services/previewToken'
import { ManualDomainProvider, type DnsResolver } from '../site/domainProvider/manual'
import { CloudflareDomainProvider } from '../site/domainProvider/cloudflare'
import { imageSize } from '../site/services/assetService'
import { createLead } from '../site/services/leadService'
import { buildCopyPrompt, parseCopy } from '../site/services/aiCopyService'
import { resolveContent, collectRefs } from '../site/content/resolve'
import { siteEntitlements } from '../site/entitlements'

const SHARED = path.resolve(__dirname, '../../../shared/validation-cases')
interface RouteCases {
  match: { path: string; expect: unknown }[]
  build: { key: SiteRouteKey; params: Record<string, string>; expect: string | null }[]
  base: { base: string; path: string; expect: string }[]
  hosts: { env: NodeJS.ProcessEnv; cases: { host: string; expect: unknown }[] }
}
interface SectionCases {
  types: Record<string, string[]>
  valid: { name: string; section: unknown }[]
  invalid: { name: string; section: unknown }[]
}
const routes = JSON.parse(
  fs.readFileSync(path.join(SHARED, 'site-routes.json'), 'utf8')
) as RouteCases
const sections = JSON.parse(
  fs.readFileSync(path.join(SHARED, 'site-sections.json'), 'utf8')
) as SectionCases

/** "@repeat:N:<json>" → an array of N copies (keeps the case file short). */
function expand(v: unknown): unknown {
  if (typeof v === 'string' && v.startsWith('@repeat:')) {
    const [, n, ...rest] = v.split(':')
    return Array.from({ length: Number(n) }, () => JSON.parse(rest.join(':')))
  }
  if (Array.isArray(v)) return v.map(expand)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]))
  return v
}

describe('route registry (shared parity cases)', () => {
  it.each<[string, unknown]>(routes.match.map((c) => [c.path, c.expect]))(
    'match %s',
    (p, expected) => {
      const m = matchSitePath(p)
      const got =
        m.type === 'route'
          ? { type: m.type, key: m.key, params: m.params }
          : m.type === 'redirect'
            ? { type: m.type, to: m.to }
            : { type: m.type }
      expect(got).toEqual(expected)
    }
  )

  it.each<[SiteRouteKey, Record<string, string>, string | null]>(
    routes.build.map((c) => [c.key, c.params, c.expect])
  )('build %s %o', (key, params, expected) => {
    const run = () => buildSitePath(key, params)
    if (expected === null) expect(run).toThrow()
    else expect(run()).toBe(expected)
  })

  it.each<[string, string, string]>(routes.base.map((c) => [c.base, c.path, c.expect]))(
    'base %s + %s',
    (base, p, expected) => expect(withSiteBase(base, p)).toBe(expected)
  )

  it('every buildable route key round-trips through the matcher', () => {
    const params: Partial<Record<SiteRouteKey, Record<string, string>>> = {
      page: { slug: 'about' },
      service: { slug: 'x' },
      provider: { slug: 'x' },
      product: { slug: 'x' },
      legal: { slug: 'privacy' },
      preview: { pageId: 'clx1abc2def3ghi4' },
    }
    for (const key of SITE_ROUTE_KEYS) {
      const m = matchSitePath(buildSitePath(key, params[key] ?? {}))
      expect(m.type === 'route' && m.key, key).toBe(key)
    }
  })
})

describe('host classification (shared parity cases)', () => {
  it.each<[string, unknown]>(routes.hosts.cases.map((c) => [c.host, c.expect]))(
    '%s',
    (host, expected) => expect(classifyHost(host, routes.hosts.env)).toEqual(expected)
  )
})

describe('section schemas (shared parity cases)', () => {
  it('the section type and variant lists match the shared definition exactly', () => {
    const mine = Object.fromEntries(
      Object.entries(SECTION_SETTINGS).map(([k, v]) => [k, [...v.variants]])
    )
    expect(mine).toEqual(sections.types)
  })
  it.each<[string, unknown]>(sections.valid.map((c) => [c.name, c.section]))(
    'accepts %s',
    (_n, s) => expect(() => parseSection(expand(s))).not.toThrow()
  )
  it.each<[string, unknown]>(sections.invalid.map((c) => [c.name, c.section]))(
    'rejects %s',
    (_n, s) => expect(() => parseSection(expand(s))).toThrow()
  )
})

describe('CORS policy', () => {
  const policy = parseCorsOrigins('https://app.medoflow.test, https://*.medoflow.test')
  it.each([
    ['https://app.medoflow.test', true],
    ['https://everwell.medoflow.test', true],
    ['http://everwell.medoflow.test', false],
    ['https://a.b.medoflow.test', false],
    ['https://evil-medoflow.test', false],
    ['https://medoflow.test.evil.example', false],
    ['https://everwell.medoflow.test/path', false],
    ['https://user@everwell.medoflow.test', false],
    ['null', false],
  ])('%s → %s', (origin, ok) => expect(matchesStaticPolicy(origin, policy)).toBe(ok))
})

describe('preview tokens', () => {
  it('grant one page of one clinic for 30 minutes', () => {
    const now = 1_800_000_000_000
    const { token, expiresAt } = createPreviewToken('clinicA', 'pageA', now)
    expect(expiresAt.getTime()).toBe(now + PREVIEW_TTL_SECONDS * 1000)
    expect(verifyPreviewToken(token, now + 60_000)).toEqual({
      clinicId: 'clinicA',
      pageId: 'pageA',
    })
    expect(verifyPreviewToken(token, now + PREVIEW_TTL_SECONDS * 1000 + 1000)).toBeNull()
  })
  it('reject tampering, truncation and junk', () => {
    const { token } = createPreviewToken('clinicA', 'pageA')
    const [body, sig] = token.split('.')
    const forged = Buffer.from(`clinicB.pageA.${Math.floor(Date.now() / 1000) + 3600}`).toString(
      'base64url'
    )
    for (const bad of [
      `${forged}.${sig}`,
      `${body}.${sig!.slice(0, -1)}x`,
      body!,
      '',
      'a.b',
      'x'.repeat(500),
    ]) {
      expect(verifyPreviewToken(bad)).toBeNull()
    }
  })
})

describe('manual DNS verification', () => {
  const input = { hostname: 'www.clinic.example', verifyToken: 'tok123', providerRef: null }
  const dns = (over: Partial<DnsResolver>): DnsResolver => ({
    resolveTxt: () => Promise.reject(new Error('ENODATA')),
    resolveCname: () => Promise.reject(new Error('ENODATA')),
    resolve4: () => Promise.reject(new Error('ENODATA')),
    ...over,
  })
  afterEach(() => vi.unstubAllEnvs())

  it('needs the ownership TXT record first', async () => {
    const r = await new ManualDomainProvider(dns({})).check(input)
    expect(r.status).toBe('FAILED')
    expect(r.error).toMatch(/_medoflow-verify\.www\.clinic\.example/)
  })
  it('then a CNAME to the site target (or a flattened apex with the same IPs)', async () => {
    vi.stubEnv('SITE_CNAME_TARGET', 'sites.medoflow.test')
    const txt = () => Promise.resolve([['medoflow-verify=tok123']])
    expect((await new ManualDomainProvider(dns({ resolveTxt: txt })).check(input)).status).toBe(
      'FAILED'
    )
    const cname = await new ManualDomainProvider(
      dns({ resolveTxt: txt, resolveCname: () => Promise.resolve(['Sites.Medoflow.Test.']) })
    ).check(input)
    expect(cname.status).toBe('VERIFIED')
    const flat = await new ManualDomainProvider(
      dns({
        resolveTxt: txt,
        resolve4: (n) =>
          Promise.resolve(n === 'sites.medoflow.test' ? ['1.2.3.4', '5.6.7.8'] : ['1.2.3.4']),
      })
    ).check(input)
    expect(flat.status).toBe('VERIFIED')
    const wrongIp = await new ManualDomainProvider(
      dns({
        resolveTxt: txt,
        resolve4: (n) => Promise.resolve(n === 'sites.medoflow.test' ? ['1.2.3.4'] : ['9.9.9.9']),
      })
    ).check(input)
    expect(wrongIp.status).toBe('FAILED')
  })
})

describe('Cloudflare for SaaS provider', () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const reply = (result: unknown, ok = true) =>
    Promise.resolve(
      new Response(
        JSON.stringify({ success: ok, errors: ok ? [] : [{ message: 'bad hostname' }], result }),
        { status: ok ? 200 : 400 }
      )
    )
  const make = (responder: (url: string, init?: RequestInit) => Promise<Response>) =>
    new CloudflareDomainProvider({
      apiToken: 'cf-test-token',
      zoneId: 'zone123',
      apiBase: 'https://cf.test/client/v4',
      fetch: (url, init) => {
        calls.push({ url, init })
        return responder(url, init)
      },
    })

  it('registers a custom hostname with TLS ≥ 1.2 and returns its DNS records', async () => {
    const p = make(() =>
      reply({
        id: 'ch_1',
        hostname: 'www.clinic.example',
        status: 'pending',
        ssl: {
          status: 'pending_validation',
          validation_records: [{ txt_name: '_acme-challenge.www.clinic.example', txt_value: 'v1' }],
        },
        ownership_verification: {
          type: 'txt',
          name: '_cf-custom-hostname.www.clinic.example',
          value: 'own1',
        },
      })
    )
    const r = await p.register({
      hostname: 'www.clinic.example',
      verifyToken: 't',
      providerRef: null,
    })
    expect(r.providerRef).toBe('ch_1')
    expect(r.records.map((x) => x.purpose)).toEqual(['routing', 'ownership', 'certificate'])
    const sent = calls[calls.length - 1]!
    expect(sent.url).toBe('https://cf.test/client/v4/zones/zone123/custom_hostnames')
    expect(JSON.parse(sent.init?.body as string)).toMatchObject({
      ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    })
    expect((sent.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer cf-test-token'
    )
  })

  it('pending → VERIFIED only when hostname and certificate are both active', async () => {
    const input = { hostname: 'www.clinic.example', verifyToken: 't', providerRef: 'ch_1' }
    const pending = await make(() =>
      reply({
        id: 'ch_1',
        hostname: input.hostname,
        status: 'pending',
        ssl: { status: 'pending_validation' },
      })
    ).check(input)
    expect(pending.status).toBe('PENDING')
    const half = await make(() =>
      reply({
        id: 'ch_1',
        hostname: input.hostname,
        status: 'active',
        ssl: { status: 'pending_validation' },
      })
    ).check(input)
    expect(half.status).toBe('PENDING')
    const active = await make(() =>
      reply({ id: 'ch_1', hostname: input.hostname, status: 'active', ssl: { status: 'active' } })
    ).check(input)
    expect(active).toMatchObject({ status: 'VERIFIED', sslStatus: 'active' })
  })

  it('surfaces API errors', async () => {
    await expect(
      make(() => reply(null, false)).register({
        hostname: 'x.example',
        verifyToken: 't',
        providerRef: null,
      })
    ).rejects.toThrow(/bad hostname/)
  })
})

describe('image dimensions from headers', () => {
  it('reads PNG, GIF and JPEG sizes; unknown bytes → null', () => {
    const png = Buffer.alloc(32)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1200, 16)
    png.writeUInt32BE(800, 20)
    expect(imageSize(png)).toEqual({ width: 1200, height: 800 })
    const gif = Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1')
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 })
    const jpg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0, 0, 0, 0, 0,
    ])
    expect(imageSize(jpg)).toEqual({ width: 640, height: 480 })
    expect(imageSize(Buffer.from('not an image'))).toBeNull()
  })
})

describe('lead spam filters (no database touched)', () => {
  const base = { name: 'Q', email: 'q@example.test', message: 'hello' }
  it('honeypot and too-fast submissions are dropped silently', async () => {
    const now = Date.now()
    await expect(
      createLead('c1', { ...base, website: 'spam', startedAt: now - 10_000 }, now)
    ).resolves.toEqual({ accepted: true, id: null })
    await expect(createLead('c1', { ...base, startedAt: now - 500 }, now)).resolves.toEqual({
      accepted: true,
      id: null,
    })
    await expect(createLead('c1', { ...base }, now)).resolves.toEqual({ accepted: true, id: null })
    await expect(
      createLead('c1', { ...base, startedAt: now - 2 * 86_400_000 }, now)
    ).resolves.toEqual({ accepted: true, id: null })
  })
})

describe('AI home copy', () => {
  it('the prompt carries business facts only', () => {
    const { userMessage, systemPrompt } = buildCopyPrompt({
      clinicName: 'Everwell Clinic',
      services: ['Physio assessment'],
      disciplines: ['Physiotherapy'],
    })
    expect(userMessage).toContain('Everwell Clinic')
    expect(userMessage).toContain('Physio assessment')
    expect(systemPrompt).toMatch(/Never invent/)
    // The facts type has no patient fields at all; nothing else is interpolated.
    expect(userMessage).not.toMatch(/patient|@|\d{3}-\d{4}/i)
  })
  it('parses model output defensively', () => {
    expect(parseCopy('{"headline":"  Move   better  ","eyebrow":"Physio"}')).toMatchObject({
      headline: 'Move better',
      eyebrow: 'Physio',
    })
    expect(parseCopy('{"eyebrow":"no headline"}')).toBeNull()
    expect(parseCopy('not json')).toBeNull()
  })
})

describe('render-time link and image resolution', () => {
  const targets = {
    pages: new Map([['p1', '/about']]),
    services: new Map([['s1', 'follow-up']]),
    providers: new Map(),
    products: new Map(),
    hasStore: false,
  }
  it('resolves typed links; missing targets become null; stored content is untouched', () => {
    const content = {
      a: { label: 'About', link: { kind: 'page', pageId: 'p1' } },
      b: { label: 'Gone', link: { kind: 'page', pageId: 'deleted' } },
      c: { label: 'Book', link: { kind: 'booking', serviceId: 's1' } },
      d: { label: 'Shop', link: { kind: 'route', route: 'store' } },
      e: { label: 'Call', link: { kind: 'external', href: 'tel:+15550100' } },
      img: { assetId: 'a1', alt: 'x' },
      sample: { src: '/site-samples/hero-clarity.svg', alt: 'y' },
    }
    const out = resolveContent(
      content,
      targets,
      new Map([['a1', { url: 'https://cdn.test/a1.png', width: 10, height: 5 }]])
    )
    expect(out.a.link).toMatchObject({ href: '/about' })
    expect(out.b.link).toMatchObject({ href: null })
    expect(out.c.link).toMatchObject({ href: '/book/follow-up' })
    expect(out.d.link).toMatchObject({ href: null }) // no store
    expect(out.e.link).toMatchObject({ href: 'tel:+15550100' })
    expect(out.img).toMatchObject({ url: 'https://cdn.test/a1.png', width: 10 })
    expect(out.sample).toMatchObject({ url: '/site-samples/hero-clarity.svg' })
    expect(JSON.stringify(content)).not.toContain('href":"/about')
    expect([...collectRefs(content).assets]).toEqual(['a1'])
  })
})

describe('plan entitlements', () => {
  it('custom domains and badge removal are paid; unknown plans fall back to FREE', () => {
    expect(siteEntitlements('FREE')).toMatchObject({ maxCustomDomains: 0, canRemoveBadge: false })
    expect(siteEntitlements('STARTER').maxCustomDomains).toBe(1)
    expect(siteEntitlements('GROWTH').canRemoveBadge).toBe(true)
    expect(siteEntitlements(null).maxPages).toBe(siteEntitlements('FREE').maxPages)
  })
})

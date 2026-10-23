/**
 * Component 8 — clinic-site routing on the frontend: the route registry and
 * host classification run the same shared cases as the backend
 * (shared/validation-cases/site-routes.json), plus the edge-routing rules
 * middleware.ts applies and the legacy /clinic/* redirects.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildSitePath,
  matchSitePath,
  SITE_ROUTE_KEYS,
  trySitePath,
  withSiteBase,
} from '@/lib/site/routes'
import { classifyHost, normalizeHost, type HostEnv } from '@/lib/site/host'
import { decideEdgeRoute } from '@/lib/site/edgeRouting'
import { legacyClinicTarget } from '@/lib/site/legacyRedirect'
import type { SiteRouteKey } from '@/lib/site/types'

interface RouteCases {
  match: { path: string; expect: unknown }[]
  build: { key: SiteRouteKey; params: Record<string, string>; expect: string | null }[]
  base: { base: string; path: string; expect: string }[]
  hosts: { env: HostEnv; cases: { host: string; expect: unknown }[] }
}
const cases = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../shared/validation-cases/site-routes.json'),
    'utf8'
  )
) as RouteCases

describe('route registry — shared parity cases', () => {
  it.each(cases.match.map((c) => [c.path, c.expect] as const))('match %s', (p, expected) => {
    const m = matchSitePath(p)
    const got =
      m.type === 'route'
        ? { type: m.type, key: m.key, params: m.params }
        : m.type === 'redirect'
          ? { type: m.type, to: m.to }
          : { type: m.type }
    expect(got).toEqual(expected)
  })
  it.each(cases.build.map((c) => [c.key, c.params, c.expect] as const))(
    'build %s %o',
    (key, params, expected) => {
      if (expected === null) {
        expect(() => buildSitePath(key, params)).toThrow()
        expect(trySitePath(key, params)).toBeNull()
      } else {
        expect(buildSitePath(key, params)).toBe(expected)
      }
    }
  )
  it.each(cases.base.map((c) => [c.base, c.path, c.expect] as const))(
    'base %s + %s',
    (base, p, expected) => {
      expect(withSiteBase(base, p)).toBe(expected)
    }
  )
  it('every route key round-trips', () => {
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
      expect(m.type === 'route' && m.key).toBe(key)
    }
  })
})

describe('host classification — shared parity cases', () => {
  it.each(cases.hosts.cases.map((c) => [c.host, c.expect] as const))('%s', (host, expected) => {
    expect(classifyHost(host, cases.hosts.env)).toEqual(expected)
  })
  it('normalises ports, case and trailing dots', () => {
    expect(normalizeHost('Everwell.Example.COM.:8443')).toBe('everwell.example.com')
    expect(normalizeHost(null)).toBeNull()
  })
})

describe('edge routing (middleware.ts)', () => {
  const env = {
    SITE_ROOT_DOMAIN: 'medoflow.test',
    APP_HOSTS: 'app.medoflow.test,localhost,127.0.0.1,*.workers.dev',
  }
  const go = (
    host: string,
    pathname: string,
    search = '',
    appOrigin: string | null = 'https://app.medoflow.test'
  ) => decideEdgeRoute({ host, pathname, search, appOrigin, env })

  it('app host: dashboard untouched; /s/<slug> rewrites to the internal site tree', () => {
    expect(go('app.medoflow.test', '/dashboard')).toEqual({ action: 'next' })
    expect(go('localhost:3000', '/s/everwell')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/~everwell',
    })
    expect(go('mf.acct.workers.dev', '/s/everwell/team/dr-lee')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/~everwell/team/dr-lee',
    })
    expect(go('app.medoflow.test', '/s/Bad_Slug')).toEqual({ action: 'next' })
  })

  it('clinic host: site paths rewrite to /clinic-site/<host>/<path>', () => {
    expect(go('everwell.medoflow.test', '/')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/everwell.medoflow.test',
    })
    expect(go('www.everwellclinic.com:443', '/services/follow-up')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/www.everwellclinic.com/services/follow-up',
    })
    expect(go('everwell.medoflow.test', '/sitemap.xml')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/everwell.medoflow.test/sitemap.xml',
    })
    expect(go('everwell.medoflow.test', '/book')).toEqual({
      action: 'rewrite',
      pathname: '/clinic-site/everwell.medoflow.test/book',
    })
  })

  it('clinic host: patient flows and static files are served as-is', () => {
    for (const p of [
      '/checkout',
      '/payment/apt_1',
      '/account/appointments',
      '/consultation/tok',
      '/intake/x',
    ]) {
      expect(go('everwell.medoflow.test', p)).toEqual({ action: 'next' })
    }
    expect(go('everwell.medoflow.test', '/book/svc_1', '?clinicId=c1')).toEqual({ action: 'next' })
    expect(go('everwell.medoflow.test', '/site-samples/hero.svg')).toEqual({ action: 'next' })
    expect(go('everwell.medoflow.test', '/Medoflow-logo.svg')).toEqual({ action: 'next' })
  })

  it('clinic host: staff routes move to the app host', () => {
    expect(go('everwell.medoflow.test', '/dashboard/site', '?x=1')).toEqual({
      action: 'redirect',
      url: 'https://app.medoflow.test/dashboard/site?x=1',
      status: 307,
    })
    expect(go('everwell.medoflow.test', '/login', '', null)).toEqual({ action: 'next' })
  })

  it('the internal tree is never reachable directly', () => {
    expect(go('app.medoflow.test', '/clinic-site/everwell.medoflow.test')).toEqual({
      action: 'notFound',
    })
    expect(go('everwell.medoflow.test', '/clinic-site')).toEqual({ action: 'notFound' })
  })

  it('first-builder /clinic/<id> URLs 308 to the new routes on any host', () => {
    expect(go('localhost:3000', '/clinic/Everwell')).toEqual({
      action: 'redirect',
      url: '/s/everwell',
      status: 308,
    })
    expect(go('app.medoflow.test', '/clinic/everwell/p/about', '?a=1')).toEqual({
      action: 'redirect',
      url: '/s/everwell/about?a=1',
      status: 308,
    })
    expect(go('app.medoflow.test', '/clinic/everwell/p/home')).toEqual({
      action: 'redirect',
      url: '/s/everwell',
      status: 308,
    })
    expect(go('everwell.medoflow.test', '/clinic/everwell/store')).toEqual({
      action: 'redirect',
      url: '/store',
      status: 308,
    })
    // Deeper first-builder paths are not redirects; the app answers them.
    expect(go('everwell.medoflow.test', '/clinic/everwell/store/x')).toEqual({ action: 'next' })
  })

  it('unknown hosts fall through to the app (which shows its own pages)', () => {
    expect(go('10.0.0.1', '/')).toEqual({ action: 'next' })
  })
})

describe('legacy /clinic/<id> URLs', () => {
  const env = { SITE_ROOT_DOMAIN: 'medoflow.test', APP_HOSTS: 'app.medoflow.test,localhost' }
  it('go to the site root on a clinic host and to /s/<id> on the app host', () => {
    expect(legacyClinicTarget('everwell.medoflow.test', 'everwell', '/store', env)).toBe('/store')
    expect(legacyClinicTarget('app.medoflow.test', 'Everwell', '/', env)).toBe('/s/everwell')
    expect(legacyClinicTarget('localhost:3000', 'everwell', '/about', env)).toBe(
      '/s/everwell/about'
    )
  })
})

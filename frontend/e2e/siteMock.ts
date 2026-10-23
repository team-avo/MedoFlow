/**
 * Stateful stand-in for the website-builder API (Component 8), for the
 * mocked e2e suite. Two halves share one state:
 *   - page.route() answers the browser's calls (/site/*, /public/sites/*);
 *   - a small HTTP server on the mock API port answers the Next server's own
 *     SSR calls (render / sitemap), which page.route() cannot see.
 * It uses the backend's real template catalog, so installs and previews are
 * the templates clinics actually get. The real API behaviour is proven by
 * backend/src/tests/integration/site*.int.test.ts. Synthetic data only.
 */
import http from 'node:http'
import type { Page, Route } from '@playwright/test'
import { corsHeaders, fail, ok } from './mockApi'
import { SITE_TEMPLATES } from '../../backend/src/site/templates'

export const MOCK_CLINIC = { id: 'clinic-e2e', slug: 'everwell', name: 'Everwell Synthetic Clinic' }
const API_PORT = 3999

type Kind = 'HOME' | 'STANDARD' | 'SERVICES' | 'TEAM' | 'CONTACT' | 'LEGAL'
interface Sec {
  id: string
  type: string
  variant: string
  hidden: boolean
  settings: Record<string, unknown>
}
interface MockPage {
  id: string
  kind: Kind
  slug: string
  title: string
  draftTitle: string
  status: 'DRAFT' | 'PUBLISHED'
  version: number
  draft: Sec[]
  live: Sec[]
  showInNav: boolean
  navOrder: number
  noindex: boolean
  seoTitle: string | null
  draftSeoTitle: string | null
  seoDescription: string | null
  draftSeoDescription: string | null
  revisions: { version: number; sections: Sec[]; createdAt: string }[]
}
interface MockDomain {
  id: string
  kind: 'SUBDOMAIN' | 'CUSTOM'
  hostname: string
  status: 'PENDING' | 'VERIFIED' | 'FAILED'
  isPrimary: boolean
  dnsReady: boolean
}

export interface SiteState {
  templateKey: string | null
  settingsDraft: Record<string, unknown> | null
  settingsPublished: Record<string, unknown> | null
  publishedAt: string | null
  pages: MockPage[]
  domains: MockDomain[]
  leads: {
    id: string
    name: string
    email: string
    phone: string | null
    message: string
    status: 'NEW' | 'READ' | 'ARCHIVED'
    sourcePath: string | null
    createdAt: string
    body: Record<string, unknown>
  }[]
  plan: { maxPages: number; maxCustomDomains: number; canRemoveBadge: boolean; maxAssets: number }
  calls: string[]
  ssrCalls: string[]
}

const DATA = {
  services: [
    {
      id: 'svc-1',
      slug: 'new-patient-visit',
      name: 'New patient visit',
      durationMinutes: 45,
      price: '120.00',
      discipline: 'General care',
    },
    {
      id: 'svc-2',
      slug: 'follow-up',
      name: 'Follow-up consultation',
      durationMinutes: 20,
      price: '65.00',
      discipline: 'General care',
    },
  ],
  providers: [
    {
      id: 'prv-1',
      slug: 'dr-alex-rivera',
      name: 'Dr. Alex Rivera',
      bio: 'Synthetic clinician profile.',
      headshotUrl: null,
      languages: ['English'],
      disciplines: ['General care'],
      serviceIds: ['svc-1', 'svc-2'],
    },
  ],
  products: [] as unknown[],
  packages: [] as unknown[],
  memberships: [] as unknown[],
  locations: [
    {
      id: 'loc-1',
      name: 'Main clinic',
      addressLines: ['100 Sample Street', 'Springfield'],
      phone: '555-0100',
      timezone: 'UTC',
      isVirtual: false,
    },
  ],
}

let seq = 0
const nid = (p: string) => `${p}${(++seq).toString(36).padStart(10, '0')}`
const sid = () => `s_${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`

const pagePath = (p: Pick<MockPage, 'kind' | 'slug'>) =>
  p.kind === 'HOME'
    ? '/'
    : p.kind === 'SERVICES'
      ? '/services'
      : p.kind === 'TEAM'
        ? '/team'
        : p.kind === 'CONTACT'
          ? '/contact'
          : p.kind === 'LEGAL'
            ? `/legal/${p.slug}`
            : `/${p.slug}`

function summary(p: MockPage) {
  const changed =
    p.status !== 'PUBLISHED' ||
    JSON.stringify(p.draft) !== JSON.stringify(p.live) ||
    p.draftTitle !== p.title ||
    p.draftSeoTitle !== p.seoTitle
  return {
    id: p.id,
    kind: p.kind,
    slug: p.slug,
    path: pagePath(p),
    title: p.draftTitle,
    status: p.status,
    showInNav: p.showInNav,
    navOrder: p.navOrder,
    noindex: p.noindex,
    version: p.version,
    publishedAt: p.status === 'PUBLISHED' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    hasUnpublishedChanges: changed,
  }
}
function detail(p: MockPage) {
  return {
    ...summary(p),
    seoTitle: p.draftSeoTitle,
    seoDescription: p.draftSeoDescription,
    ogImageAssetId: null,
    sections: p.draft,
    live: {
      title: p.title,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      sections: p.live,
    },
  }
}

function siteUrls(s: SiteState) {
  const sub = s.domains.find((d) => d.kind === 'SUBDOMAIN')!
  const primaryCustom = s.domains.find(
    (d) => d.kind === 'CUSTOM' && d.isPrimary && d.status === 'VERIFIED'
  )
  const canonical = primaryCustom
    ? `https://${primaryCustom.hostname}`
    : `http://${sub.hostname}:4310`
  return {
    canonical,
    canonicalKind: 'domain',
    subdomain: `http://${sub.hostname}:4310`,
    appPath: `http://127.0.0.1:4310/s/${MOCK_CLINIC.slug}`,
    custom: s.domains
      .filter((d) => d.kind === 'CUSTOM' && d.status === 'VERIFIED')
      .map((d) => `https://${d.hostname}`),
  }
}

function overview(s: SiteState) {
  return {
    id: 'site-e2e',
    clinic: {
      id: MOCK_CLINIC.id,
      name: MOCK_CLINIC.name,
      slug: MOCK_CLINIC.slug,
      legacyLogoUrl: null,
    },
    templateKey: s.templateKey,
    version: 1,
    publishedAt: s.publishedAt,
    settings: s.settingsDraft ?? SITE_TEMPLATES[0]!.settings,
    settingsPublished: s.settingsPublished,
    hasUnpublishedSettings: JSON.stringify(s.settingsDraft) !== JSON.stringify(s.settingsPublished),
    pages: s.pages.map(summary),
    urls: siteUrls(s),
    entitlements: s.plan,
  }
}

/** Mirrors backend content/resolve.ts closely enough for rendering. */
function resolve<T>(value: T, s: SiteState, live: boolean): T {
  const pages = new Map(
    s.pages.filter((p) => !live || p.status === 'PUBLISHED').map((p) => [p.id, pagePath(p)])
  )
  const go = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(go)
    const o = v as Record<string, unknown>
    if (typeof o.kind === 'string' && !('settings' in o)) {
      const href =
        o.kind === 'page'
          ? (pages.get(o.pageId as string) ?? null)
          : o.kind === 'route'
            ? o.route === 'home'
              ? '/'
              : o.route === 'store'
                ? null
                : `/${o.route as string}`
            : o.kind === 'booking'
              ? '/book'
              : o.kind === 'external'
                ? o.href
                : o.kind === 'anchor'
                  ? `#${o.sectionId as string}`
                  : null
      return { ...o, href }
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = go(x)
    if (typeof o.src === 'string' && 'alt' in o) out.url = o.src
    return out
  }
  return go(value) as T
}

function renderPayload(s: SiteState, path: string, preview: { pageId: string } | null) {
  const settings = preview ? s.settingsDraft : s.settingsPublished
  if (!settings) return null
  const base = {
    site: {
      clinicId: MOCK_CLINIC.id,
      name: MOCK_CLINIC.name,
      slug: MOCK_CLINIC.slug,
      canonicalBase: siteUrls(s).canonical,
      settings: resolve(settings, s, !preview),
      showBadge: !s.plan.canRemoveBadge,
      legacyLogoUrl: null,
      hasStore: false,
    },
    entity: null,
    data: DATA,
    preview: !!preview,
  }
  const page = preview
    ? s.pages.find((p) => p.id === preview.pageId)
    : s.pages.find((p) => p.status === 'PUBLISHED' && pagePath(p) === path)
  if (!page)
    return {
      status: 404,
      payload: { ...base, route: { key: 'not-found', path, params: {} }, page: null },
    }
  return {
    status: 200,
    payload: {
      ...base,
      route: {
        key:
          page.kind === 'HOME'
            ? 'home'
            : page.kind === 'STANDARD'
              ? 'page'
              : page.kind.toLowerCase(),
        path: pagePath(page),
        params: {},
      },
      page: {
        id: page.id,
        kind: page.kind,
        title: preview ? page.draftTitle : page.title,
        seoTitle: preview ? page.draftSeoTitle : page.seoTitle,
        seoDescription: preview ? page.draftSeoDescription : page.seoDescription,
        noindex: !!preview || page.noindex,
        sections: resolve(preview ? page.draft : page.live, s, !preview),
      },
    },
  }
}

function render(s: SiteState, q: URLSearchParams) {
  const host = q.get('host')
  const clinic = q.get('clinic')
  const path = q.get('path') || '/'
  const knownHost =
    host &&
    s.domains.some(
      (d) => (d.kind === 'SUBDOMAIN' ? d.hostname : d.hostname) === host && d.status === 'VERIFIED'
    )
  if (!(knownHost || clinic === MOCK_CLINIC.slug || clinic === MOCK_CLINIC.id))
    return { status: 404, body: { success: false, code: 'site_unknown', message: 'No site here' } }
  if (path !== '/' && path.endsWith('/'))
    return {
      status: 200,
      body: {
        success: true,
        data: { redirect: { type: 'redirect', to: path.replace(/\/+$/, ''), code: 301 } },
      },
    }
  const pm = /^\/preview\/([a-z0-9]+)$/.exec(path)
  const preview = pm && q.get('preview') === `token-${pm[1]}` ? { pageId: pm[1]! } : null
  const r = renderPayload(s, path, preview)
  if (!r)
    return {
      status: 404,
      body: { success: false, code: 'site_unknown', message: 'Site not published' },
    }
  return { status: r.status, body: { success: r.status === 200, data: r.payload } }
}

function bindTemplate(key: string, s: SiteState) {
  const t = SITE_TEMPLATES.find((x) => x.key === key)!
  const idBySlug = new Map(s.pages.map((p) => [p.slug, p.id]))
  for (const tp of t.pages) {
    if (!idBySlug.has(tp.slug)) {
      const id = nid('pg')
      idBySlug.set(tp.slug, id)
      s.pages.push({
        id,
        kind: tp.kind,
        slug: tp.slug,
        title: tp.title,
        draftTitle: tp.title,
        status: 'DRAFT',
        version: 0,
        draft: [],
        live: [],
        showInNav: tp.showInNav,
        navOrder: 0,
        noindex: false,
        seoTitle: null,
        draftSeoTitle: tp.seoTitle ?? null,
        seoDescription: null,
        draftSeoDescription: tp.seoDescription ?? null,
        revisions: [],
      })
    }
  }
  const bind = <T>(v: T): T =>
    JSON.parse(
      JSON.stringify(v).replace(
        /"pageId":"tpl_([a-z0-9-]+)"/g,
        (_m, slug: string) => `"pageId":"${idBySlug.get(slug)}"`
      )
    ) as T
  for (const tp of t.pages) {
    const p = s.pages.find((x) => x.slug === tp.slug)!
    p.draft = bind(
      tp.sections.map((x) => ({
        id: sid(),
        type: x.type,
        variant: x.variant ?? '',
        hidden: false,
        settings: x.settings,
      }))
    ) as Sec[]
    p.draftTitle = tp.title
  }
  s.settingsDraft = bind(t.settings) as unknown as Record<string, unknown>
  s.templateKey = key
}

function publishPage(p: MockPage) {
  p.version += 1
  p.live = structuredClone(p.draft)
  p.title = p.draftTitle
  p.seoTitle = p.draftSeoTitle
  p.seoDescription = p.draftSeoDescription
  p.status = 'PUBLISHED'
  p.revisions.unshift({
    version: p.version,
    sections: structuredClone(p.draft),
    createdAt: new Date().toISOString(),
  })
}

const domainView = (d: MockDomain) => ({
  id: d.id,
  kind: d.kind,
  hostname: d.hostname,
  status: d.status,
  isPrimary: d.isPrimary,
  sslStatus: d.status === 'VERIFIED' ? 'active' : null,
  lastError:
    d.status === 'FAILED' ? 'TXT record not found yet (DNS changes can take up to an hour)' : null,
  lastCheckedAt: null,
  verifiedAt: null,
  url: d.kind === 'SUBDOMAIN' ? `http://${d.hostname}:4310` : `https://${d.hostname}`,
  records:
    d.kind === 'CUSTOM'
      ? [
          { type: 'CNAME', name: d.hostname, value: 'sites.localhost', purpose: 'routing' },
          {
            type: 'TXT',
            name: `_medoflow-verify.${d.hostname}`,
            value: 'medoflow-verify=e2etoken',
            purpose: 'ownership',
          },
        ]
      : [],
})

export function newSiteState(): SiteState {
  return {
    templateKey: null,
    settingsDraft: null,
    settingsPublished: null,
    publishedAt: null,
    pages: [],
    domains: [
      {
        id: 'dom-sub',
        kind: 'SUBDOMAIN',
        hostname: 'everwell.localhost',
        status: 'VERIFIED',
        isPrimary: true,
        dnsReady: true,
      },
    ],
    leads: [],
    plan: { maxPages: 8, maxCustomDomains: 1, canRemoveBadge: false, maxAssets: 40 },
    calls: [],
    ssrCalls: [],
  }
}

/** HTTP half: answers the Next server's SSR calls on the mock API port. */
export function startSiteSsrServer(state: () => SiteState): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${API_PORT}`)
    const s = state()
    s.ssrCalls.push(`${req.method} ${url.pathname}${url.search}`)
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/v1/public/sites/render') {
      const r = render(s, url.searchParams)
      return send(r.status, r.body)
    }
    if (url.pathname === '/api/v1/public/sites/sitemap') {
      const base = siteUrls(s).canonical
      return send(200, {
        success: true,
        data: {
          canonicalBase: base,
          entries: s.pages
            .filter((p) => p.status === 'PUBLISHED' && !p.noindex)
            .map((p) => ({ loc: `${base}${pagePath(p) === '/' ? '/' : pagePath(p)}` })),
        },
      })
    }
    send(404, { success: false, message: 'Not mocked' })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(API_PORT, '127.0.0.1', () => resolve(server))
  })
}

/** Browser half: page.route() for the builder and public site calls. */
export async function installSiteMock(page: Page, s: SiteState) {
  await page.route(
    /http:\/\/127\.0\.0\.1:3999\/api\/v1\/(site|public\/sites|public\/clinics)/,
    async (route: Route) => {
      const req = route.request()
      const method = req.method()
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(route) })
      const url = new URL(req.url())
      const path = url.pathname.replace(/^\/api\/v1/, '')
      s.calls.push(`${method} ${path}`)
      const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
      const findPage = (id: string) => s.pages.find((p) => p.id === id)
      let m: RegExpExecArray | null

      if (method === 'GET' && path === '/site') return ok(route, overview(s))
      if (method === 'GET' && path === '/site/editor-data') {
        return ok(route, {
          data: DATA,
          pages: s.pages.map((p) => ({
            id: p.id,
            kind: p.kind,
            slug: p.slug,
            title: p.draftTitle,
            status: p.status,
            path: pagePath(p),
          })),
          assets: [],
          clinic: { name: MOCK_CLINIC.name, legacyLogoUrl: null },
          hasStore: false,
          showBadge: true,
        })
      }
      if (method === 'PUT' && path === '/site/settings') {
        s.settingsDraft = body.settings as Record<string, unknown>
        return ok(route, { settings: s.settingsDraft })
      }
      if (method === 'POST' && path === '/site/publish') {
        const ids =
          body.pageIds === 'all'
            ? s.pages
                .filter(
                  (p) =>
                    p.version === 0 ||
                    (p.status === 'PUBLISHED' && JSON.stringify(p.draft) !== JSON.stringify(p.live))
                )
                .map((p) => p.id)
            : (body.pageIds as string[])
        ids.forEach((id) => publishPage(findPage(id)!))
        s.settingsPublished = structuredClone(s.settingsDraft)
        s.publishedAt = new Date().toISOString()
        return ok(route, overview(s))
      }
      if (method === 'POST' && path === '/site/preview-link') {
        const id = body.pageId as string
        return ok(route, {
          token: `token-${id}`,
          url: `http://everwell.localhost:4310/preview/${id}?token=token-${id}`,
          expiresAt: new Date(Date.now() + 1800_000).toISOString(),
        })
      }
      if (method === 'POST' && path === '/site/ai/home-copy')
        return ok(route, { generated: false, pageId: s.pages[0]?.id })
      if (method === 'GET' && path === '/site/templates') {
        return ok(route, {
          items: SITE_TEMPLATES.map((t) => ({
            key: t.key,
            name: t.name,
            tagline: t.tagline,
            description: t.description,
            bestFor: t.bestFor,
            previewImage: t.previewImage,
            theme: t.settings.theme,
            pages: t.pages.map((p) => ({ kind: p.kind, slug: p.slug, title: p.title })),
          })),
        })
      }
      if ((m = /^\/site\/templates\/([a-z0-9-]+)\/install$/.exec(path)) && method === 'POST') {
        bindTemplate(m[1]!, s)
        return ok(route, overview(s))
      }
      if ((m = /^\/public\/sites\/templates\/([a-z0-9-]+)\/preview$/.exec(path))) {
        const t = SITE_TEMPLATES.find((x) => x.key === m![1])!
        const slug = url.searchParams.get('page') ?? 'home'
        const tp = t.pages.find((p) => p.slug === slug) ?? t.pages[0]!
        return ok(route, {
          site: {
            clinicId: 'template-preview',
            name: 'Your Clinic',
            slug: null,
            canonicalBase: '',
            settings: resolve(t.settings, s, false),
            showBadge: false,
            legacyLogoUrl: null,
            hasStore: false,
          },
          route: { key: 'home', path: '/', params: {} },
          page: {
            id: `t-${t.key}`,
            kind: tp.kind,
            title: tp.title,
            seoTitle: null,
            seoDescription: null,
            noindex: true,
            sections: resolve(
              tp.sections.map((x) => ({
                id: sid(),
                type: x.type,
                variant: x.variant ?? '',
                hidden: false,
                settings: x.settings,
              })),
              s,
              false
            ),
          },
          entity: null,
          data: DATA,
          preview: true,
        })
      }
      if (method === 'GET' && path === '/site/pages')
        return ok(route, { items: s.pages.map(summary) })
      if ((m = /^\/site\/pages\/([a-z0-9]+)$/.exec(path))) {
        const p = findPage(m[1]!)
        if (!p) return fail(route, 404, 'site_not_found', 'Page not found')
        if (method === 'GET') return ok(route, detail(p))
        if (method === 'PUT') {
          if (body.sections) p.draft = body.sections as Sec[]
          if (typeof body.title === 'string') p.draftTitle = body.title
          if ('seoTitle' in body) p.draftSeoTitle = (body.seoTitle as string | null) ?? null
          if ('seoDescription' in body)
            p.draftSeoDescription = (body.seoDescription as string | null) ?? null
          return ok(route, detail(p))
        }
      }
      if (
        (m = /^\/site\/pages\/([a-z0-9]+)\/(publish|unpublish)$/.exec(path)) &&
        method === 'POST'
      ) {
        const p = findPage(m[1]!)!
        if (m[2] === 'publish') publishPage(p)
        else {
          p.status = 'DRAFT'
          p.live = []
        }
        return ok(route, detail(p))
      }
      if ((m = /^\/site\/pages\/([a-z0-9]+)\/revisions$/.exec(path))) {
        return ok(route, {
          items: findPage(m[1]!)!.revisions.map((r) => ({
            id: `rev-${r.version}`,
            version: r.version,
            title: 'Home',
            createdAt: r.createdAt,
          })),
        })
      }
      if ((m = /^\/site\/pages\/([a-z0-9]+)\/revisions\/(\d+)\/restore$/.exec(path))) {
        const p = findPage(m[1]!)!
        p.draft = structuredClone(p.revisions.find((r) => r.version === Number(m![2]))!.sections)
        return ok(route, detail(p))
      }
      if (method === 'GET' && path === '/site/domains')
        return ok(route, { rootDomain: 'localhost', domains: s.domains.map(domainView) })
      if (method === 'POST' && path === '/site/domains') {
        const d: MockDomain = {
          id: nid('dom'),
          kind: 'CUSTOM',
          hostname: String(body.hostname).toLowerCase(),
          status: 'PENDING',
          isPrimary: false,
          dnsReady: false,
        }
        s.domains.push(d)
        return ok(route, domainView(d))
      }
      if ((m = /^\/site\/domains\/([a-z0-9-]+)\/verify$/.exec(path))) {
        const d = s.domains.find((x) => x.id === m![1])!
        d.status = d.dnsReady ? 'VERIFIED' : 'FAILED'
        return ok(route, domainView(d))
      }
      if (method === 'GET' && path === '/site/assets') return ok(route, { items: [] })
      if (method === 'POST' && path === '/public/sites/leads') {
        s.leads.unshift({
          id: nid('lead'),
          name: String(body.name),
          email: String(body.email),
          phone: (body.phone as string) ?? null,
          message: String(body.message),
          status: 'NEW',
          sourcePath: (body.sourcePath as string) ?? null,
          createdAt: new Date().toISOString(),
          body,
        })
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: corsHeaders(route),
          body: JSON.stringify({ success: true, data: { accepted: true } }),
        })
      }
      if (method === 'GET' && path === '/site/leads') {
        const items = s.leads
          .filter((l) => l.status !== 'ARCHIVED')
          .map(({ message: _m, body: _b, ...rest }) => rest)
        return ok(route, { items, unread: s.leads.filter((l) => l.status === 'NEW').length })
      }
      if ((m = /^\/site\/leads\/([a-z0-9]+)$/.exec(path)) && method === 'GET') {
        const l = s.leads.find((x) => x.id === m![1])!
        l.status = 'READ'
        const { body: _b, ...rest } = l
        return ok(route, rest)
      }
      if (path.startsWith('/public/clinics'))
        return ok(route, {
          clinic: { id: MOCK_CLINIC.id, name: MOCK_CLINIC.name, slug: MOCK_CLINIC.slug },
        })
      return route.fallback()
    }
  )
}

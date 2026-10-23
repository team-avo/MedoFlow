/**
 * Component 8 — clinic website builder, end to end against Postgres
 * (tenant guard enforcing + RLS). Covers B8.1 (CRUD tenant-scoped + audited,
 * drafts never public), B8.3 (templates), B8.4 (sections), B8.5 (render,
 * redirects, assets, leads, minimum-necessary public data) and B8.6
 * (revisions, preview links).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { invalidateHostCache } from '../../site/services/hostService'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let slugA: string
let hostA: string
const t = {} as Record<'aAdmin' | 'aProvider' | 'aFrontDesk' | 'aPatient' | 'bAdmin', string>

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('site-a')
  B = await createClinicFixture('site-b')
  for (const [k, fx, role] of [
    ['aAdmin', A, 'admin'],
    ['aProvider', A, 'provider'],
    ['aFrontDesk', A, 'frontDesk'],
    ['aPatient', A, 'patient'],
    ['bAdmin', B, 'admin'],
  ] as const) {
    t[k] = (await login(server.url, fx.users[role].email)).accessToken
  }
  slugA = (await adminDb.clinic.findUniqueOrThrow({ where: { id: A.clinicId } })).slug!
  hostA = `${slugA}.site.test`
  // A product with internal inventory details that must never be public.
  await adminDb.product.create({
    data: {
      clinicId: A.clinicId,
      name: 'Sample Balm',
      slug: 'sample-balm',
      price: new Prisma.Decimal(20),
      inventoryItem: {
        create: {
          clinicId: A.clinicId,
          quantityInStock: 4,
          supplier: 'INTERNAL-SUPPLIER-XYZ',
          batchNumber: 'BATCH-INTERNAL-77',
        },
      },
    },
  })
  await adminDb.provider.update({
    where: { id: A.providerId },
    data: {
      email: 'provider-private@example.test',
      phone: '555-0199',
      licenseNumber: 'LIC-PRIVATE-1',
    },
  })
})
afterAll(() => server.close())

const render = (q: Record<string, string>) =>
  api(server.url, `/public/sites/render?${new URLSearchParams(q).toString()}`)

const auditRows = (clinicId: string, action: string) =>
  adminDb.auditLog.findMany({ where: { clinicId, action }, orderBy: { createdAt: 'desc' } })

async function homeOf(token: string) {
  const pages = await api(server.url, '/site/pages', { token })
  return (pages.body.data.items as { id: string; kind: string }[]).find((p) => p.kind === 'HOME')!
}

describe('B8.3 templates', () => {
  it('lists five templates; detail includes page bodies', async () => {
    const list = await api(server.url, '/site/templates', { token: t.aAdmin })
    expect(list.status).toBe(200)
    expect(list.body.data.items.map((x: { key: string }) => x.key)).toEqual([
      'clarity',
      'serenity',
      'vitality',
      'heritage',
      'botanica',
    ])
    const one = await api(server.url, '/site/templates/heritage', { token: t.aAdmin })
    expect(one.body.data.pageBodies.length).toBeGreaterThan(4)
    expect((await api(server.url, '/site/templates/nope', { token: t.aAdmin })).status).toBe(404)
  })

  it('install (replace) creates the template pages as drafts — nothing goes live', async () => {
    const res = await api(server.url, '/site/templates/clarity/install', {
      token: t.aAdmin,
      body: { mode: 'replace' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const kinds = (res.body.data.pages as { kind: string; status: string }[]).map((p) => p.kind)
    expect(kinds).toEqual(
      expect.arrayContaining(['HOME', 'SERVICES', 'TEAM', 'CONTACT', 'LEGAL', 'STANDARD'])
    )
    expect((res.body.data.pages as { status: string }[]).every((p) => p.status === 'DRAFT')).toBe(
      true
    )
    expect(res.body.data.templateKey).toBe('clarity')
    // Header links to template pages were bound to the real page ids.
    expect(JSON.stringify(res.body.data.settings)).not.toContain('tpl_')
    expect(await auditRows(A.clinicId, 'SITE_TEMPLATE_INSTALLED')).toHaveLength(1)

    const live = await render({ host: hostA, path: '/' })
    expect(live.status).toBe(404) // home not published yet
  })

  it('install (styles-only) changes the theme and leaves pages alone', async () => {
    const before = await api(server.url, '/site/pages', { token: t.aAdmin })
    const res = await api(server.url, '/site/templates/serenity/install', {
      token: t.aAdmin,
      body: { mode: 'styles-only' },
    })
    expect(res.status).toBe(200)
    expect(res.body.data.settings.theme.fontPair).toBe('editorial')
    expect(res.body.data.pages.length).toBe(before.body.data.items.length)
    // back to clarity styling for the rest of the suite
    await api(server.url, '/site/templates/clarity/install', {
      token: t.aAdmin,
      body: { mode: 'styles-only' },
    })
  })
})

describe('B8.1 pages: tenant-scoped, audited, role-gated', () => {
  let pageId: string

  it('creates a page and audits it (ids and counts only)', async () => {
    const res = await api(server.url, '/site/pages', {
      token: t.aAdmin,
      body: { slug: 'about-team', title: 'About the team', sections: [] },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    pageId = res.body.data.id
    const [row] = await auditRows(A.clinicId, 'SITE_PAGE_CREATED')
    expect(row).toMatchObject({
      entityType: 'SitePage',
      entityId: pageId,
      performedById: A.users.admin.id,
    })
  })

  it('another clinic cannot read, edit, publish or delete it', async () => {
    for (const [method, path] of [
      ['GET', `/site/pages/${pageId}`],
      ['PUT', `/site/pages/${pageId}`],
      ['POST', `/site/pages/${pageId}/publish`],
      ['DELETE', `/site/pages/${pageId}`],
    ] as const) {
      const res = await api(server.url, path, {
        token: t.bAdmin,
        method,
        body: method === 'PUT' ? { title: 'hijack' } : undefined,
      })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    expect(
      (await api(server.url, '/site/pages', { token: t.bAdmin })).body.data.items
    ).toHaveLength(0)
  })

  it('providers, front desk and patients cannot use the builder', async () => {
    for (const tok of [t.aProvider, t.aFrontDesk, t.aPatient]) {
      expect((await api(server.url, '/site/pages', { token: tok })).status).toBe(403)
      expect((await api(server.url, '/site', { token: tok })).status).toBe(403)
    }
    expect((await api(server.url, '/site/pages')).status).toBe(401)
  })

  it('refuses reserved slugs, duplicates and invalid sections', async () => {
    const bad = [
      { slug: 'dashboard', title: 'x' },
      { slug: 'about-team', title: 'dup' },
      { slug: 'Bad Slug', title: 'x' },
      {
        slug: 'ok-page',
        title: 'x',
        sections: [{ id: 's_aaaa1111', type: 'iframe', settings: {} }],
      },
      {
        slug: 'ok-page',
        title: 'x',
        sections: [
          {
            id: 's_aaaa1111',
            type: 'hero',
            settings: {
              headline: 'x',
              primaryCta: { label: 'Go', link: { kind: 'external', href: 'javascript:alert(1)' } },
            },
          },
        ],
      },
    ]
    const codes = []
    for (const body of bad)
      codes.push((await api(server.url, '/site/pages', { token: t.aAdmin, body })).status)
    expect(codes).toEqual([422, 409, 422, 422, 422])
  })

  it('the home page cannot be deleted; a standard page can (audited)', async () => {
    const home = await homeOf(t.aAdmin)
    expect(
      (await api(server.url, `/site/pages/${home.id}`, { token: t.aAdmin, method: 'DELETE' }))
        .status
    ).toBe(409)
    const tmp = await api(server.url, '/site/pages', {
      token: t.aAdmin,
      body: { slug: 'temp-page', title: 'Temp' },
    })
    expect(
      (
        await api(server.url, `/site/pages/${tmp.body.data.id}`, {
          token: t.aAdmin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200)
    expect(
      (await auditRows(A.clinicId, 'SITE_PAGE_DELETED')).some(
        (r) => r.entityId === tmp.body.data.id
      )
    ).toBe(true)
  })

  it('the legacy /site-pages path still works and says it is deprecated', async () => {
    const res = await api(server.url, '/site-pages', { token: t.aAdmin })
    expect(res.status).toBe(200)
    expect(res.headers.get('deprecation')).toBe('true')
  })
})

describe('B8.1 drafts are never public', () => {
  it('only a published page renders, and later draft edits stay private until republished', async () => {
    const home = await homeOf(t.aAdmin)
    const editor = await api(server.url, `/site/pages/${home.id}`, { token: t.aAdmin })
    const sections = editor.body.data.sections as {
      type: string
      settings: Record<string, unknown>
    }[]
    const hero = sections.find((s) => s.type === 'hero')!
    hero.settings.headline = 'Published headline one'
    expect(
      (
        await api(server.url, `/site/pages/${home.id}`, {
          token: t.aAdmin,
          method: 'PUT',
          body: { sections, seoTitle: 'SEO one' },
        })
      ).status
    ).toBe(200)
    // Still a draft: nothing public.
    expect((await render({ host: hostA, path: '/' })).status).toBe(404)
    expect((await api(server.url, `/public/clinics/${slugA}/pages/home`)).status).toBe(404)

    const pub = await api(server.url, `/site/pages/${home.id}/publish`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(pub.status).toBe(200)
    expect(pub.body.data.version).toBe(1)

    const live = await render({ host: hostA, path: '/' })
    expect(live.status).toBe(200)
    expect(JSON.stringify(live.body.data.page)).toContain('Published headline one')
    expect(live.body.data.page.seoTitle).toBe('SEO one')
    expect(live.headers.get('cache-control')).toContain('s-maxage=60')
    expect(live.headers.get('etag')).toBeTruthy()
    // Legacy endpoint resolves the clinic by slug now (was 404).
    const legacy = await api(server.url, `/public/clinics/${slugA}/pages/home`)
    expect(legacy.status).toBe(200)

    // Edit again — content, title and SEO — without publishing.
    hero.settings.headline = 'Secret draft headline'
    await api(server.url, `/site/pages/${home.id}`, {
      token: t.aAdmin,
      method: 'PUT',
      body: { sections, title: 'Secret draft title', seoTitle: 'Secret draft SEO' },
    })
    for (const res of [
      await render({ host: hostA, path: '/' }),
      await api(server.url, `/public/clinics/${A.clinicId}/pages/home`),
    ]) {
      const body = JSON.stringify(res.body)
      expect(body).not.toContain('Secret draft')
      expect(body).toContain('Published headline one')
    }

    await api(server.url, `/site/pages/${home.id}/publish`, { token: t.aAdmin, method: 'POST' })
    expect(JSON.stringify((await render({ host: hostA, path: '/' })).body)).toContain(
      'Secret draft headline'
    )
    expect(await auditRows(A.clinicId, 'SITE_PAGE_PUBLISHED')).toHaveLength(2)
  })

  it('revisions are kept per publish and restore into the draft only', async () => {
    const home = await homeOf(t.aAdmin)
    const revs = await api(server.url, `/site/pages/${home.id}/revisions`, { token: t.aAdmin })
    expect(revs.body.data.items.map((r: { version: number }) => r.version)).toEqual([2, 1])
    const restored = await api(server.url, `/site/pages/${home.id}/revisions/1/restore`, {
      token: t.aAdmin,
      method: 'POST',
    })
    expect(restored.status).toBe(200)
    expect(JSON.stringify(restored.body.data.sections)).toContain('Published headline one')
    // Live is still version 2 until the restored draft is published.
    expect(JSON.stringify((await render({ host: hostA, path: '/' })).body)).toContain(
      'Secret draft headline'
    )
    expect(await auditRows(A.clinicId, 'SITE_PAGE_RESTORED')).toHaveLength(1)
    expect(
      (
        await api(server.url, `/site/pages/${home.id}/revisions/1/restore`, {
          token: t.bAdmin,
          method: 'POST',
        })
      ).status
    ).toBe(404)
  })

  it('unpublish takes a page offline and clears its live copy', async () => {
    const res = await api(server.url, '/site/pages', {
      token: t.aAdmin,
      body: {
        slug: 'seasonal',
        title: 'Seasonal',
        sections: [{ id: 's_seas0001', type: 'rich-text', settings: { body: 'Flu clinic' } }],
      },
    })
    const id = res.body.data.id
    await api(server.url, `/site/pages/${id}/publish`, { token: t.aAdmin, method: 'POST' })
    expect((await render({ host: hostA, path: '/seasonal' })).status).toBe(200)
    await api(server.url, `/site/pages/${id}/unpublish`, { token: t.aAdmin, method: 'POST' })
    expect((await render({ host: hostA, path: '/seasonal' })).status).toBe(404)
    const row = await adminDb.sitePage.findUniqueOrThrow({ where: { id } })
    expect(row.sectionsJson).toEqual([])
    expect(await auditRows(A.clinicId, 'SITE_PAGE_UNPUBLISHED')).toHaveLength(1)
  })
})

describe('B8.6 preview links', () => {
  it('a signed link shows the draft (noindex, no-store); forged or foreign links do not', async () => {
    const home = await homeOf(t.aAdmin)
    const editor = await api(server.url, `/site/pages/${home.id}`, { token: t.aAdmin })
    const sections = editor.body.data.sections
    sections.find((s: { type: string }) => s.type === 'hero').settings.headline =
      'Preview-only headline'
    await api(server.url, `/site/pages/${home.id}`, {
      token: t.aAdmin,
      method: 'PUT',
      body: { sections },
    })

    const link = await api(server.url, '/site/preview-link', {
      token: t.aAdmin,
      body: { pageId: home.id },
    })
    expect(link.status).toBe(200)
    const token: string = link.body.data.token
    expect(link.body.data.url).toContain(`/preview/${home.id}?token=`)

    const ok = await render({ host: hostA, path: `/preview/${home.id}`, preview: token })
    expect(ok.status).toBe(200)
    expect(ok.body.data.preview).toBe(true)
    expect(ok.body.data.page.noindex).toBe(true)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(ok.body)).toContain('Preview-only headline')

    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA')
    expect(
      (await render({ host: hostA, path: `/preview/${home.id}`, preview: tampered })).status
    ).toBe(404)
    expect((await render({ host: hostA, path: `/preview/${home.id}` })).status).toBe(404)
    const slugB = (await adminDb.clinic.findUniqueOrThrow({ where: { id: B.clinicId } })).slug!
    expect(
      (await render({ host: `${slugB}.site.test`, path: `/preview/${home.id}`, preview: token }))
        .status
    ).toBe(404)
    // The live page is untouched.
    expect(JSON.stringify((await render({ host: hostA, path: '/' })).body)).not.toContain(
      'Preview-only'
    )
  })
})

describe('B8.5 settings, links and redirects', () => {
  it('site settings are validated, drafted, and live only after site publish', async () => {
    const site = await api(server.url, '/site', { token: t.aAdmin })
    const settings = site.body.data.settings
    const bad = structuredClone(settings)
    bad.header.links.push({
      label: 'Evil',
      link: { kind: 'external', href: 'javascript:alert(1)' },
    })
    expect(
      (
        await api(server.url, '/site/settings', {
          token: t.aAdmin,
          method: 'PUT',
          body: { settings: bad },
        })
      ).status
    ).toBe(422)

    settings.announcement = { enabled: true, text: 'Draft-only announcement', link: null }
    expect(
      (
        await api(server.url, '/site/settings', {
          token: t.aAdmin,
          method: 'PUT',
          body: { settings },
        })
      ).status
    ).toBe(200)
    expect(JSON.stringify((await render({ host: hostA, path: '/' })).body)).not.toContain(
      'Draft-only announcement'
    )

    const pub = await api(server.url, '/site/publish', {
      token: t.aAdmin,
      body: { pageIds: 'all' },
    })
    expect(pub.status, JSON.stringify(pub.body)).toBe(200)
    const live = await render({ host: hostA, path: '/' })
    expect(live.body.data.site.settings.announcement.text).toBe('Draft-only announcement')
    // Typed links are resolved to paths at render time.
    const links = live.body.data.site.settings.header.links as {
      label: string
      link: { href: string | null }
    }[]
    expect(links.find((l) => l.label === 'Services')!.link.href).toBe('/services')
    expect(links.find((l) => l.label === 'About')!.link.href).toBe('/about')
    expect(await auditRows(A.clinicId, 'SITE_PUBLISHED')).toHaveLength(1)
  })

  it('renaming a published page slug leaves a 301 behind', async () => {
    const pages = await api(server.url, '/site/pages', { token: t.aAdmin })
    const about = pages.body.data.items.find((p: { slug: string }) => p.slug === 'about')
    await api(server.url, `/site/pages/${about.id}`, {
      token: t.aAdmin,
      method: 'PUT',
      body: { slug: 'about-us' },
    })
    const old = await render({ host: hostA, path: '/about' })
    expect(old.body.data.redirect).toEqual({ type: 'redirect', to: '/about-us', code: 301 })
    expect((await render({ host: hostA, path: '/about-us' })).status).toBe(200)
    // The header link follows the page automatically.
    const header = (await render({ host: hostA, path: '/' })).body.data.site.settings.header.links
    expect(header.find((l: { label: string }) => l.label === 'About').link.href).toBe('/about-us')
  })

  it('manual redirects: create, collapse chains, refuse loops, CSV import', async () => {
    const mk = (fromPath: string, toPath: string) =>
      api(server.url, '/site/redirects', { token: t.aAdmin, body: { fromPath, toPath } })
    expect((await mk('/our-team.html', '/team')).status).toBe(201)
    expect((await mk('/old-team', '/our-team.html')).body.data.toPath).toBe('/team') // collapsed
    expect((await mk('/team-loop', '/team-loop')).status).toBe(422)
    expect((await mk('/x', 'javascript:alert(1)')).status).toBe(422)
    const r = await render({ host: hostA, path: '/our-team.html' })
    expect(r.body.data.redirect.to).toBe('/team')
    const imp = await api(server.url, '/site/redirects/import', {
      token: t.aAdmin,
      body: { csv: 'from,to\n/contact-us.php,/contact\n/bad,javascript:1\n' },
    })
    expect(imp.body.data.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false])
  })

  it('normalises URLs (case, trailing slash) with a 301 and 404s unknown paths', async () => {
    expect((await render({ host: hostA, path: '/About-Us/' })).body.data.redirect.to).toBe(
      '/about-us'
    )
    const nf = await render({ host: hostA, path: '/does-not-exist' })
    expect(nf.status).toBe(404)
    expect(nf.body.data.route.key).toBe('not-found')
    expect(nf.body.data.site.settings.theme).toBeTruthy() // branded 404
  })

  it('service/provider/product URLs come from slugs; changing one redirects', async () => {
    const svc = await adminDb.service.findUniqueOrThrow({ where: { id: A.serviceId } })
    expect(svc.slug).toBeTruthy()
    expect(
      (await render({ host: hostA, path: `/services/${svc.slug}` })).body.data.entity.service.name
    ).toBe('Consult')
    const res = await api(server.url, `/site/slugs/service/${A.serviceId}`, {
      token: t.aAdmin,
      method: 'PUT',
      body: { slug: 'consultation' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(
      (await render({ host: hostA, path: `/services/${svc.slug}` })).body.data.redirect.to
    ).toBe('/services/consultation')
    expect(
      (
        await api(server.url, `/site/slugs/service/${A.serviceId}`, {
          token: t.bAdmin,
          method: 'PUT',
          body: { slug: 'x-1' },
        })
      ).status
    ).toBe(404)
  })
})

describe('B8.5 public data is minimum-necessary', () => {
  it('team and store pages carry no provider contact details or inventory internals', async () => {
    const team = JSON.stringify((await render({ host: hostA, path: '/team' })).body)
    expect(team).toContain('Pat')
    for (const secret of ['provider-private@example.test', '555-0199', 'LIC-PRIVATE-1'])
      expect(team).not.toContain(secret)
    const store = await render({ host: hostA, path: '/store' })
    expect(store.status).toBe(200)
    const storeJson = JSON.stringify(store.body)
    expect(storeJson).toContain('Sample Balm')
    expect(storeJson).not.toContain('INTERNAL-SUPPLIER-XYZ')
    expect(storeJson).not.toContain('BATCH-INTERNAL-77')
    const product = await render({ host: hostA, path: '/store/sample-balm' })
    expect(product.body.data.entity.product).toMatchObject({ name: 'Sample Balm', inStock: true })
  })

  it('the builder canvas data uses the same minimum-necessary shapes', async () => {
    const res = await api(server.url, '/site/editor-data', { token: t.aAdmin })
    expect(res.status).toBe(200)
    expect(res.body.data.data.services.length).toBeGreaterThan(0)
    expect(res.body.data.pages.length).toBeGreaterThan(0)
    const json = JSON.stringify(res.body)
    for (const secret of [
      'provider-private@example.test',
      'LIC-PRIVATE-1',
      'INTERNAL-SUPPLIER-XYZ',
    ]) {
      expect(json).not.toContain(secret)
    }
    expect((await api(server.url, '/site/editor-data', { token: t.aFrontDesk })).status).toBe(403)
  })

  it('the existing public storefront endpoints are trimmed too', async () => {
    const providers = JSON.stringify(
      (await api(server.url, `/public/clinics/${slugA}/providers`)).body
    )
    expect(providers).not.toContain('provider-private@example.test')
    const products = JSON.stringify(
      (await api(server.url, `/public/clinics/${slugA}/products`)).body
    )
    expect(products).not.toContain('INTERNAL-SUPPLIER-XYZ')
    expect(products).toContain('quantityInStock')
    const clinics = JSON.stringify((await api(server.url, '/public/clinics')).body)
    expect(clinics).not.toContain('subscriptionPlan')
  })

  it('sitemap lists only published, indexable URLs', async () => {
    const res = await api(server.url, `/public/sites/sitemap?host=${hostA}`)
    expect(res.status).toBe(200)
    const locs = (res.body.data.entries as { loc: string }[]).map((e) => e.loc)
    expect(locs.some((l) => l.endsWith('/about-us'))).toBe(true)
    expect(locs.some((l) => l.endsWith('/seasonal'))).toBe(false) // unpublished
    expect(locs.some((l) => l.endsWith('/services/consultation'))).toBe(true)
    expect(locs.some((l) => l.includes('/preview/'))).toBe(false)
  })
})

describe('B8.5 contact-form leads (PHI)', () => {
  const lead = (extra: Record<string, unknown> = {}) => ({
    clinic: slugA,
    name: 'Quinn Marlowe',
    email: 'quinn.marlowe@example.test',
    phone: '555-0142',
    message: 'Synthetic enquiry: asking about knee pain appointments.',
    startedAt: Date.now() - 10_000,
    ...extra,
  })

  it('bots are accepted silently but nothing is stored', async () => {
    const before = await adminDb.siteLead.count({ where: { clinicId: A.clinicId } })
    expect(
      (await api(server.url, '/public/sites/leads', { body: lead({ website: 'http://spam' }) }))
        .status
    ).toBe(201)
    expect(
      (await api(server.url, '/public/sites/leads', { body: lead({ startedAt: Date.now() }) }))
        .status
    ).toBe(201)
    expect(await adminDb.siteLead.count({ where: { clinicId: A.clinicId } })).toBe(before)
  })

  it('a real enquiry is sealed at rest, listed without the message, read with audit', async () => {
    expect((await api(server.url, '/public/sites/leads', { body: lead() })).status).toBe(201)
    const raw = await adminDb.siteLead.findFirstOrThrow({ where: { clinicId: A.clinicId } })
    for (const f of [raw.name, raw.email, raw.message]) expect(f.startsWith('fle:v1:')).toBe(true)

    const list = await api(server.url, '/site/leads', { token: t.aFrontDesk })
    expect(list.status).toBe(200)
    expect(list.body.data.unread).toBe(1)
    expect(list.body.data.items[0].name).toBe('Quinn Marlowe')
    expect(JSON.stringify(list.body)).not.toContain('knee pain')

    const one = await api(server.url, `/site/leads/${raw.id}`, { token: t.aFrontDesk })
    expect(one.body.data.message).toContain('knee pain')
    expect(one.headers.get('cache-control')).toBe('no-store')
    const [audit] = await auditRows(A.clinicId, 'SITE_LEAD_READ')
    expect(audit).toMatchObject({ entityId: raw.id, performedById: A.users.frontDesk.id })
    expect(JSON.stringify(audit)).not.toContain('knee pain')

    expect((await api(server.url, `/site/leads/${raw.id}`, { token: t.aProvider })).status).toBe(
      403
    )
    expect((await api(server.url, `/site/leads/${raw.id}`, { token: t.bAdmin })).status).toBe(404)
  })
})

describe('B8.5 website images', () => {
  const png = (() => {
    const b = Buffer.alloc(64)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8)
    b.write('IHDR', 12, 'ascii')
    b.writeUInt32BE(640, 16)
    b.writeUInt32BE(480, 20)
    return b
  })()

  async function uploadImage(body: Buffer, mimeType = 'image/png') {
    const intent = await api(server.url, '/site/assets/uploads', {
      token: t.aAdmin,
      body: { mimeType, size: body.length, alt: 'Clinic front desk' },
    })
    expect(intent.status, JSON.stringify(intent.body)).toBe(201)
    const { assetId, upload } = intent.body.data
    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body })
    expect(put.status).toBe(200)
    return {
      assetId,
      complete: await api(server.url, `/site/assets/${assetId}/complete`, {
        token: t.aAdmin,
        method: 'POST',
      }),
    }
  }

  it('upload → complete verifies the bytes and reads the dimensions', async () => {
    const { assetId, complete } = await uploadImage(png)
    expect(complete.status).toBe(200)
    expect(complete.body.data).toMatchObject({ status: 'AVAILABLE', width: 640, height: 480 })
    const file = new URL(complete.body.data.url as string).pathname.split('/').pop()
    const served = await fetch(`${server.url}/public/sites/assets/${A.clinicId}/${file}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(
      (await auditRows(A.clinicId, 'SITE_ASSET_UPLOADED')).some((r) => r.entityId === assetId)
    ).toBe(true)

    // In use on a page → cannot be deleted.
    const pages = await api(server.url, '/site/pages', { token: t.aAdmin })
    const target = pages.body.data.items.find((p: { slug: string }) => p.slug === 'about-team')
    const page = await api(server.url, `/site/pages/${target.id}`, {
      token: t.aAdmin,
      method: 'PUT',
      body: {
        sections: [
          { id: 's_gall0001', type: 'gallery', settings: { images: [{ assetId, alt: 'x' }] } },
        ],
      },
    })
    expect(page.status).toBe(200)
    expect(
      (await api(server.url, `/site/assets/${assetId}`, { token: t.aAdmin, method: 'DELETE' }))
        .status
    ).toBe(409)
    expect(
      (await api(server.url, `/site/assets/${assetId}`, { token: t.bAdmin, method: 'DELETE' }))
        .status
    ).toBe(404)
  })

  it('rejects files that are not the declared image type, and SVG outright', async () => {
    const { complete } = await uploadImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')
    )
    expect(complete.status).toBe(422)
    const svg = await api(server.url, '/site/assets/uploads', {
      token: t.aAdmin,
      body: { mimeType: 'image/svg+xml', size: 100 },
    })
    expect(svg.status).toBe(415)
  })
})

describe('B8.7 plan limits', () => {
  it('FREE allows 8 pages; the 9th is refused with 402', async () => {
    const count = await adminDb.sitePage.count({ where: { clinicId: A.clinicId } })
    for (let i = count; i < 8; i++) {
      await api(server.url, '/site/pages', {
        token: t.aAdmin,
        body: { slug: `filler-${i}`, title: `Filler ${i}` },
      })
    }
    const res = await api(server.url, '/site/pages', {
      token: t.aAdmin,
      body: { slug: 'one-too-many', title: 'x' },
    })
    expect(res.status).toBe(402)
    expect(res.body.code).toBe('site_page_limit')
  })
})

afterAll(() => invalidateHostCache())

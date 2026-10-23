/**
 * The public renderer's single data source (B8.5): one call turns
 * (site host | clinic slug) + path into everything the page needs — the
 * published theme and menus, the matched route, the page or entity, and only
 * the live data its sections use. Every routing decision for clinic sites
 * (canonical host, redirects, drafts never public, 404) is made here.
 *
 * Runs in the public scope (no user), so every query is scoped by the
 * resolved clinicId explicitly and every field returned is minimum-necessary:
 * no provider contact details, no inventory internals, no drafts.
 */
import type { Prisma, SitePageKind } from '@prisma/client'
import prisma from '../../config/prisma'
import { readSiteSettings, type SiteSettings } from '../content/settings'
import { upgradeSections } from '../content/legacy'
import type { Section } from '../content/sections'
import { collectRefs, resolveContent, type LinkTargets } from '../content/resolve'
import { matchSitePath, type SiteRouteParams } from '../routing/matchSitePath'
import { buildSitePath } from '../routing/buildSitePath'
import type { SiteRouteKey } from '../routing/routeKeys'
import { siteEntitlements } from '../entitlements'
import { resolveHost } from './hostService'
import { siteBaseUrls } from './domainService'
import { assetPublicUrl, assetUrlMap } from './assetService'
import { findRedirect } from './redirectService'
import { verifyPreviewToken } from './previewToken'
import { pagePath } from './pageService'

export interface RenderRequest {
  host?: string
  /** Clinic slug or id — the app-host fallback /s/<slug>. */
  clinic?: string
  path: string
  previewToken?: string
}

export type RenderResult =
  | { type: 'redirect'; to: string; code: 301 | 302 }
  | { type: 'unknown-site' }
  | { type: 'page'; status: 200 | 404; payload: RenderPayload }

export interface RenderPayload {
  site: {
    clinicId: string
    name: string
    slug: string | null
    /** Where this site lives canonically (an origin, or <app>/s/<slug>). */
    canonicalBase: string
    settings: SiteSettings
    showBadge: boolean
    legacyLogoUrl: string | null
    hasStore: boolean
  }
  route: { key: SiteRouteKey | 'not-found'; path: string; params: SiteRouteParams }
  page: {
    id: string
    kind: SitePageKind
    title: string
    seoTitle: string | null
    seoDescription: string | null
    noindex: boolean
    sections: Section[]
  } | null
  entity:
    | { type: 'service'; service: PublicService }
    | { type: 'provider'; provider: PublicProvider }
    | { type: 'product'; product: PublicProduct }
    | { type: 'book'; serviceId: string | null }
    | null
  data: SectionData
  preview: boolean
}

/* ── minimum-necessary public shapes ─────────────────────────────────────── */

const SAFE_IMAGE_URL =
  /^(https:\/\/[^\s"'<>]+|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$/
const safeImage = (u: string | null | undefined) => (u && SAFE_IMAGE_URL.test(u) ? u : null)

const SERVICE_SELECT = {
  id: true,
  slug: true,
  name: true,
  duration: true,
  defaultPrice: true,
  discipline: { select: { name: true } },
} satisfies Prisma.ServiceSelect

const PROVIDER_SELECT = {
  id: true,
  slug: true,
  firstName: true,
  lastName: true,
  bio: true,
  headshotUrl: true,
  languages: true,
  disciplines: { select: { discipline: { select: { name: true } } } },
  providerServices: { select: { serviceId: true } },
} satisfies Prisma.ProviderSelect

/**
 * Products a public site may show: active, and never prescription-only. The C5
 * scope guard (ADR 0003) keeps RX_* products off every storefront; the site is one.
 */
const PUBLIC_PRODUCT_WHERE = {
  isActive: true,
  fulfillmentClass: { notIn: ['RX_NON_SCHEDULED', 'RX_SCHEDULED'] },
} satisfies Prisma.ProductWhereInput

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  price: true,
  inventoryItem: { select: { quantityInStock: true } },
} satisfies Prisma.ProductSelect

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>
type ProviderRow = Prisma.ProviderGetPayload<{ select: typeof PROVIDER_SELECT }>
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>

export interface PublicService {
  id: string
  slug: string | null
  name: string
  durationMinutes: number
  price: string
  discipline: string | null
}
export interface PublicProvider {
  id: string
  slug: string | null
  name: string
  bio: string | null
  headshotUrl: string | null
  languages: string[]
  disciplines: string[]
  serviceIds: string[]
}
export interface PublicProduct {
  id: string
  slug: string | null
  name: string
  description: string | null
  price: string
  inStock: boolean
}

const toService = (s: ServiceRow): PublicService => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  durationMinutes: s.duration,
  price: s.defaultPrice.toFixed(2),
  discipline: s.discipline?.name ?? null,
})
const toProvider = (p: ProviderRow): PublicProvider => ({
  id: p.id,
  slug: p.slug,
  name: `${p.firstName} ${p.lastName}`.trim(),
  bio: p.bio,
  headshotUrl: safeImage(p.headshotUrl),
  languages: p.languages,
  disciplines: p.disciplines.map((d) => d.discipline.name),
  serviceIds: p.providerServices.map((s) => s.serviceId),
})
const toProduct = (p: ProductRow): PublicProduct => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description,
  price: p.price.toFixed(2),
  inStock: (p.inventoryItem?.quantityInStock ?? 1) > 0,
})

export interface SectionData {
  services: PublicService[]
  providers: PublicProvider[]
  products: PublicProduct[]
  packages: {
    id: string
    name: string
    description: string | null
    price: string
    totalSessions: number | null
    expiresInDays: number | null
  }[]
  memberships: {
    id: string
    name: string
    description: string | null
    monthlyPrice: string
    serviceDiscountPercent: string
    billingPeriod: string
  }[]
  locations: {
    id: string
    name: string
    addressLines: string[]
    phone: string | null
    timezone: string
    isVirtual: boolean
  }[]
}

const emptyData = (): SectionData => ({
  services: [],
  providers: [],
  products: [],
  packages: [],
  memberships: [],
  locations: [],
})

const ONLINE = ['online', 'virtual']

/* ── section data: fetched only for section types on the page ───────────── */

async function loadSectionData(
  clinicId: string,
  sections: Section[],
  extra: { services?: boolean; providers?: boolean; products?: boolean } = {}
): Promise<SectionData> {
  const types = new Set(sections.filter((s) => !s.hidden).map((s) => s.type))
  const data = emptyData()
  const jobs: Promise<void>[] = []
  if (types.has('service-grid') || extra.services) {
    jobs.push(
      prisma.service
        .findMany({
          where: { clinicId, isActive: true, isArchived: false, discipline: { isArchived: false } },
          orderBy: { name: 'asc' },
          take: 100,
          select: SERVICE_SELECT,
        })
        .then((r) => void (data.services = r.map(toService)))
    )
  }
  if (types.has('provider-bios') || extra.providers) {
    jobs.push(
      prisma.provider
        .findMany({
          where: { clinicId, isActive: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          take: 100,
          select: PROVIDER_SELECT,
        })
        .then((r) => void (data.providers = r.map(toProvider)))
    )
  }
  if (types.has('featured-products') || extra.products) {
    jobs.push(
      prisma.product
        .findMany({
          where: { clinicId, ...PUBLIC_PRODUCT_WHERE },
          orderBy: { name: 'asc' },
          take: 100,
          select: PRODUCT_SELECT,
        })
        .then((r) => void (data.products = r.map(toProduct)))
    )
  }
  if (types.has('pricing')) {
    jobs.push(
      prisma.package
        .findMany({ where: { clinicId, isActive: true }, orderBy: { price: 'asc' }, take: 24 })
        .then(
          (r) =>
            void (data.packages = r.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              price: p.price.toFixed(2),
              totalSessions: p.totalSessions,
              expiresInDays: p.expiresInDays,
            })))
        ),
      prisma.membership
        .findMany({
          where: { clinicId, isActive: true },
          orderBy: { monthlyPrice: 'asc' },
          take: 24,
        })
        .then(
          (r) =>
            void (data.memberships = r.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              monthlyPrice: m.monthlyPrice.toFixed(2),
              serviceDiscountPercent: m.serviceDiscountPercent.toFixed(0),
              billingPeriod: m.billingPeriod,
            })))
        )
    )
  }
  if (types.has('locations-hours') || types.has('contact-form')) {
    jobs.push(
      prisma.location
        .findMany({ where: { clinicId, isActive: true }, orderBy: { name: 'asc' }, take: 20 })
        .then(
          (r) =>
            void (data.locations = r.map((l) => ({
              id: l.id,
              name: l.name,
              addressLines: [
                l.addressLine1 ?? l.address ?? '',
                l.addressLine2 ?? '',
                [l.city, l.state, l.postalCode].filter(Boolean).join(', '),
                l.country ?? '',
              ].filter((x) => x.trim()),
              phone: l.phone,
              timezone: l.timezone,
              isVirtual: ONLINE.includes(l.name.trim().toLowerCase()),
            })))
        )
    )
  }
  await Promise.all(jobs)
  return data
}

/* ── defaults for system routes the clinic hasn't built a page for ──────── */

const defaultSections: Partial<Record<SitePageKind, Section[]>> = {
  SERVICES: [
    {
      id: 's_dflsvc01',
      type: 'service-grid',
      variant: 'cards',
      hidden: false,
      settings: {
        heading: 'Services',
        intro: '',
        serviceIds: [],
        maxItems: 24,
        showPrices: true,
        showDuration: true,
      },
    },
  ],
  TEAM: [
    {
      id: 's_dflteam1',
      type: 'provider-bios',
      variant: 'grid',
      hidden: false,
      settings: { heading: 'Our team', intro: '', providerIds: [], maxItems: 24, showBio: true },
    },
  ],
  CONTACT: [
    {
      id: 's_dflcont1',
      type: 'contact-form',
      variant: 'split',
      hidden: false,
      settings: {
        heading: 'Contact us',
        intro: '',
        submitLabel: 'Send message',
        successMessage: 'Thanks — we will be in touch shortly.',
        askPhone: true,
        consentText: 'Please don’t include detailed medical information in this form.',
      },
    },
    {
      id: 's_dflcont2',
      type: 'locations-hours',
      variant: 'cards',
      hidden: false,
      settings: { heading: 'Visit us', locationIds: [], hours: [], showMapLink: true },
    },
  ],
}

/* ── main entry ─────────────────────────────────────────────────────────── */

interface SiteContext {
  clinicId: string
  name: string
  slug: string | null
  logoUrl: string | null
  plan: Parameters<typeof siteEntitlements>[0]
  settings: SiteSettings
  draftSettings: SiteSettings
  canonicalBase: string
  canonicalKind: 'domain' | 'app'
}

async function loadSite(clinicId: string): Promise<SiteContext | null> {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      themeColor: true,
      site: { select: { settingsDraftJson: true, settingsPublishedJson: true } },
      tenant: { select: { plan: true, brand: { select: { primaryColor: true, logoUrl: true } } } },
    },
  })
  if (!clinic) return null
  const primary = clinic.themeColor ?? clinic.tenant.brand?.primaryColor
  const urls = await siteBaseUrls(clinic.id)
  return {
    clinicId: clinic.id,
    name: clinic.name,
    slug: clinic.slug,
    logoUrl: safeImage(clinic.logoUrl) ?? safeImage(clinic.tenant.brand?.logoUrl),
    plan: clinic.tenant.plan,
    settings: readSiteSettings(clinic.site?.settingsPublishedJson ?? null, primary),
    draftSettings: readSiteSettings(clinic.site?.settingsDraftJson ?? null, primary),
    canonicalBase: urls.canonical,
    canonicalKind: urls.canonicalKind,
  }
}

/** Which site a request is for; host wins over the /s/<slug> fallback. */
async function locate(
  req: RenderRequest
): Promise<
  | { type: 'site'; clinicId: string; viaHost: boolean }
  | { type: 'redirect'; to: string }
  | { type: 'unknown' }
> {
  if (req.host) {
    const r = await resolveHost(req.host)
    if (r.kind === 'site') return { type: 'site', clinicId: r.clinicId, viaHost: true }
    if (r.kind === 'alias')
      return { type: 'redirect', to: `${r.origin}${req.path === '/' ? '/' : req.path}` }
    if (r.kind !== 'app' || !req.clinic) return { type: 'unknown' }
  }
  if (!req.clinic) return { type: 'unknown' }
  const clinic = await prisma.clinic.findFirst({
    where: { isActive: true, OR: [{ slug: req.clinic }, { id: req.clinic }] },
    select: { id: true },
  })
  return clinic ? { type: 'site', clinicId: clinic.id, viaHost: false } : { type: 'unknown' }
}

export async function render(req: RenderRequest): Promise<RenderResult> {
  const where = await locate(req)
  if (where.type === 'unknown') return { type: 'unknown-site' }
  if (where.type === 'redirect') return { type: 'redirect', to: where.to, code: 301 }

  const site = await loadSite(where.clinicId)
  if (!site) return { type: 'unknown-site' }
  const { clinicId } = site

  const match = matchSitePath(req.path)
  if (match.type === 'redirect') return { type: 'redirect', to: match.to, code: 301 }

  // The path fallback (/s/<slug>) 301s to the canonical domain once the
  // clinic has one — except draft previews, which work anywhere.
  const isPreview = match.type === 'route' && match.key === 'preview'
  if (!where.viaHost && !isPreview && site.canonicalKind === 'domain') {
    const suffix = match.type === 'route' ? match.path : req.path
    return {
      type: 'redirect',
      to: `${site.canonicalBase}${suffix === '/' ? '/' : suffix}`,
      code: 301,
    }
  }

  const ent = siteEntitlements(site.plan)
  const productCount = await prisma.product.count({ where: { clinicId, ...PUBLIC_PRODUCT_WHERE } })
  const base = {
    site: {
      clinicId,
      name: site.settings.brand.displayName || site.name,
      slug: site.slug,
      canonicalBase: site.canonicalBase,
      settings: site.settings,
      showBadge: !ent.canRemoveBadge,
      legacyLogoUrl: site.logoUrl,
      hasStore: productCount > 0,
    },
    preview: false,
  }

  const notFound = async (path: string): Promise<RenderResult> => {
    const redirect = await findRedirect(clinicId, path)
    if (redirect)
      return { type: 'redirect', to: redirect.toPath, code: redirect.code === 302 ? 302 : 301 }
    return finish(
      { ...base, route: { key: 'not-found', path, params: {} }, page: null, entity: null },
      [],
      404
    )
  }

  const finish = async (
    payload: Omit<RenderPayload, 'data'>,
    sections: Section[],
    status: 200 | 404,
    extra: Parameters<typeof loadSectionData>[2] = {}
  ): Promise<RenderResult> => {
    const data = await loadSectionData(clinicId, sections, extra)
    const resolved = await resolveForRender(clinicId, payload, base.site.hasStore, payload.preview)
    return { type: 'page', status, payload: { ...resolved, data } }
  }

  if (match.type === 'none') return notFound(match.path)
  const { key, params, path } = match

  const pageBy = async (kind: SitePageKind, slug?: string) =>
    prisma.sitePage.findFirst({
      where: { clinicId, kind, status: 'PUBLISHED', ...(slug ? { slug } : {}) },
    })

  const pagePayload = (
    p: NonNullable<Awaited<ReturnType<typeof pageBy>>>,
    sections: Section[]
  ): RenderPayload['page'] => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    noindex: p.noindex,
    sections,
  })

  switch (key) {
    case 'home':
    case 'page':
    case 'legal': {
      const kind: SitePageKind = key === 'home' ? 'HOME' : key === 'page' ? 'STANDARD' : 'LEGAL'
      const p = await pageBy(kind, key === 'home' ? undefined : params.slug)
      if (!p) return notFound(path)
      const sections = upgradeSections(p.sectionsJson)
      return finish(
        { ...base, route: { key, path, params }, page: pagePayload(p, sections), entity: null },
        sections,
        200
      )
    }
    case 'services':
    case 'team':
    case 'contact': {
      const kind: SitePageKind =
        key === 'services' ? 'SERVICES' : key === 'team' ? 'TEAM' : 'CONTACT'
      const p = await pageBy(kind)
      const sections = p ? upgradeSections(p.sectionsJson) : defaultSections[kind]!
      const page: RenderPayload['page'] = p
        ? pagePayload(p, sections)
        : {
            id: `system-${kind.toLowerCase()}`,
            kind,
            title: key === 'services' ? 'Services' : key === 'team' ? 'Our team' : 'Contact',
            seoTitle: null,
            seoDescription: null,
            noindex: false,
            sections,
          }
      return finish({ ...base, route: { key, path, params }, page, entity: null }, sections, 200)
    }
    case 'service': {
      const s = await prisma.service.findFirst({
        where: { clinicId, slug: params.slug, isActive: true, isArchived: false },
        select: SERVICE_SELECT,
      })
      if (!s) return notFound(path)
      return finish(
        {
          ...base,
          route: { key, path, params },
          page: null,
          entity: { type: 'service', service: toService(s) },
        },
        [],
        200,
        { providers: true, products: true }
      )
    }
    case 'provider': {
      const p = await prisma.provider.findFirst({
        where: { clinicId, slug: params.slug, isActive: true },
        select: PROVIDER_SELECT,
      })
      if (!p) return notFound(path)
      return finish(
        {
          ...base,
          route: { key, path, params },
          page: null,
          entity: { type: 'provider', provider: toProvider(p) },
        },
        [],
        200,
        { services: true }
      )
    }
    case 'store': {
      if (!base.site.hasStore) return notFound(path)
      return finish({ ...base, route: { key, path, params }, page: null, entity: null }, [], 200, {
        products: true,
      })
    }
    case 'product': {
      const p = await prisma.product.findFirst({
        where: { clinicId, slug: params.slug, ...PUBLIC_PRODUCT_WHERE },
        select: PRODUCT_SELECT,
      })
      if (!p) return notFound(path)
      return finish(
        {
          ...base,
          route: { key, path, params },
          page: null,
          entity: { type: 'product', product: toProduct(p) },
        },
        [],
        200
      )
    }
    case 'book': {
      let serviceId: string | null = null
      if (params.slug) {
        const s = await prisma.service.findFirst({
          where: { clinicId, slug: params.slug, isActive: true, isArchived: false },
          select: { id: true },
        })
        if (!s) return notFound(path)
        serviceId = s.id
      }
      return finish(
        { ...base, route: { key, path, params }, page: null, entity: { type: 'book', serviceId } },
        [],
        200,
        { services: true }
      )
    }
    case 'preview': {
      const grant = req.previewToken ? verifyPreviewToken(req.previewToken) : null
      if (!grant || grant.clinicId !== clinicId || grant.pageId !== params.pageId)
        return notFound(path)
      const p = await prisma.sitePage.findFirst({ where: { id: grant.pageId, clinicId } })
      if (!p) return notFound(path)
      const sections = upgradeSections(p.draftSectionsJson)
      const previewBase = {
        ...base,
        site: { ...base.site, settings: site.draftSettings },
        preview: true,
      }
      return finish(
        {
          ...previewBase,
          route: { key, path: pagePath(p.kind, p.slug), params },
          page: {
            id: p.id,
            kind: p.kind,
            title: p.draftTitle ?? p.title,
            seoTitle: p.draftSeoTitle,
            seoDescription: p.draftSeoDescription,
            noindex: true,
            sections,
          },
          entity: null,
        },
        sections,
        200
      )
    }
    default:
      // sitemap / robots / favicon have dedicated endpoints.
      return notFound(path)
  }
}

/** Resolves typed links and image refs in settings + sections. */
async function resolveForRender(
  clinicId: string,
  payload: Omit<RenderPayload, 'data'>,
  hasStore: boolean,
  preview: boolean
): Promise<Omit<RenderPayload, 'data'>> {
  const refs = collectRefs([payload.site.settings, payload.page?.sections ?? []])
  const [pages, services, providers, products, assets] = await Promise.all([
    prisma.sitePage.findMany({
      where: { clinicId, ...(preview ? {} : { status: 'PUBLISHED' as const }) },
      select: { id: true, kind: true, slug: true },
    }),
    refs.services.size
      ? prisma.service.findMany({
          where: { clinicId, id: { in: [...refs.services] }, isActive: true, isArchived: false },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    refs.providers.size
      ? prisma.provider.findMany({
          where: { clinicId, id: { in: [...refs.providers] }, isActive: true },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    refs.products.size
      ? prisma.product.findMany({
          where: { clinicId, id: { in: [...refs.products] }, ...PUBLIC_PRODUCT_WHERE },
          select: { id: true, slug: true },
        })
      : Promise.resolve([]),
    assetUrlMap(clinicId, refs.assets),
  ])
  const slugMap = (rows: { id: string; slug: string | null }[]) =>
    new Map(rows.filter((r) => r.slug).map((r) => [r.id, r.slug!]))
  const targets: LinkTargets = {
    pages: new Map(pages.map((p) => [p.id, pagePath(p.kind, p.slug)])),
    services: slugMap(services),
    providers: slugMap(providers),
    products: slugMap(products),
    hasStore,
  }
  return {
    ...payload,
    site: { ...payload.site, settings: resolveContent(payload.site.settings, targets, assets) },
    page: payload.page
      ? { ...payload.page, sections: resolveContent(payload.page.sections, targets, assets) }
      : null,
  }
}

/* ── sitemap ────────────────────────────────────────────────────────────── */

export async function sitemap(req: { host?: string; clinic?: string }) {
  const where = await locate({ ...req, path: '/sitemap.xml' })
  if (where.type !== 'site') return null
  const site = await loadSite(where.clinicId)
  if (!site) return null
  const { clinicId } = site
  const [pages, services, providers, products] = await Promise.all([
    prisma.sitePage.findMany({
      where: { clinicId, status: 'PUBLISHED', noindex: false },
      select: { kind: true, slug: true, publishedAt: true },
    }),
    prisma.service.findMany({
      where: { clinicId, isActive: true, isArchived: false, slug: { not: null } },
      select: { slug: true, updatedAt: true },
      take: 500,
    }),
    prisma.provider.findMany({
      where: { clinicId, isActive: true, slug: { not: null } },
      select: { slug: true, updatedAt: true },
      take: 500,
    }),
    prisma.product.findMany({
      where: { clinicId, ...PUBLIC_PRODUCT_WHERE, slug: { not: null } },
      select: { slug: true, updatedAt: true },
      take: 1000,
    }),
  ])
  const base = site.canonicalBase.replace(/\/+$/, '')
  const url = (path: string) => (path === '/' ? `${base}/` : `${base}${path}`)
  const entries: { loc: string; lastmod?: string }[] = []
  const kinds = new Set(pages.map((p) => p.kind))
  for (const p of pages) {
    entries.push({ loc: url(pagePath(p.kind, p.slug)), lastmod: p.publishedAt?.toISOString() })
  }
  if (!kinds.has('SERVICES') && services.length)
    entries.push({ loc: url(buildSitePath('services')) })
  if (!kinds.has('TEAM') && providers.length) entries.push({ loc: url(buildSitePath('team')) })
  for (const s of services) {
    entries.push({
      loc: url(buildSitePath('service', { slug: s.slug! })),
      lastmod: s.updatedAt.toISOString(),
    })
  }
  for (const p of providers) {
    entries.push({
      loc: url(buildSitePath('provider', { slug: p.slug! })),
      lastmod: p.updatedAt.toISOString(),
    })
  }
  if (products.length) entries.push({ loc: url(buildSitePath('store')) })
  for (const p of products) {
    entries.push({
      loc: url(buildSitePath('product', { slug: p.slug! })),
      lastmod: p.updatedAt.toISOString(),
    })
  }
  return { canonicalBase: base, entries }
}

/** Legacy GET /public/clinics/:id/pages/:slug — published page, id-or-slug clinic. */
export async function publishedPageForClinic(idOrSlug: string, slug: string) {
  const clinic = await prisma.clinic.findFirst({
    where: { isActive: true, OR: [{ slug: idOrSlug }, { id: idOrSlug }] },
    select: { id: true },
  })
  if (!clinic) return null
  const p = await prisma.sitePage.findFirst({
    where: { clinicId: clinic.id, slug, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      slug: true,
      sectionsJson: true,
      seoTitle: true,
      seoDescription: true,
      publishedAt: true,
    },
  })
  return p ? { ...p, sectionsJson: upgradeSections(p.sectionsJson) } : null
}

/**
 * Builder canvas data (authenticated): everything a section can show, the
 * clinic's pages for link pickers, and its images. Same public shapes as
 * the renderer — the builder never sees more than the site would.
 */
export async function editorData(clinicId: string) {
  const everySection: Section[] = (
    ['service-grid', 'provider-bios', 'featured-products', 'pricing', 'locations-hours'] as const
  ).map((type, i) => ({ id: `s_editor${i}`, type, variant: '', hidden: false, settings: {} }))
  const [data, pages, assets, site] = await Promise.all([
    loadSectionData(clinicId, everySection),
    prisma.sitePage.findMany({
      where: { clinicId },
      select: { id: true, kind: true, slug: true, title: true, draftTitle: true, status: true },
      orderBy: { navOrder: 'asc' },
    }),
    prisma.siteAsset.findMany({
      where: { clinicId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    loadSite(clinicId),
  ])
  return {
    data,
    pages: pages.map((p) => ({
      id: p.id,
      kind: p.kind,
      slug: p.slug,
      title: p.draftTitle ?? p.title,
      status: p.status,
      path: pagePath(p.kind, p.slug),
    })),
    assets: assets.map((a) => ({
      id: a.id,
      url: assetPublicUrl(a),
      alt: a.alt,
      width: a.width,
      height: a.height,
    })),
    clinic: site ? { name: site.name, legacyLogoUrl: site.logoUrl } : null,
    hasStore: data.products.length > 0,
    showBadge: site ? !siteEntitlements(site.plan).canRemoveBadge : true,
  }
}

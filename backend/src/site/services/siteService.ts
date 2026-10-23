/**
 * The clinic website as a whole (B8.3): its site-wide settings (theme,
 * header, footer, announcement, SEO), template installs and site-wide
 * publish. Like pages, settings have a draft the builder edits and a
 * published copy the public site renders.
 */
import type { Prisma, SitePageKind } from '@prisma/client'
import type { TemplatePageKind } from '../templates/types'
import prisma from '../../config/prisma'
import {
  defaultSiteSettings,
  parseSiteSettings,
  readSiteSettings,
  type SiteSettings,
} from '../content/settings'
import { newSectionId, parseSections } from '../content/sections'
import { getTemplate, SITE_TEMPLATES, templateSummary } from '../templates'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { siteEntitlements } from '../entitlements'
import { ensureEntitySlugs } from './slugService'
import { ensureDefaultSubdomain, siteBaseUrls } from './domainService'
import * as pages from './pageService'
import { createPreviewToken } from './previewToken'

// Templates declare page kinds without importing Prisma (templates/types.ts).
// This fails to compile if that union and the SitePageKind enum ever differ.
type SameKinds = [TemplatePageKind] extends [SitePageKind]
  ? [SitePageKind] extends [TemplatePageKind]
    ? true
    : false
  : false
const templateKindsMatchPrisma: SameKinds = true
void templateKindsMatchPrisma

async function clinicBrand(clinicId: string) {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      slug: true,
      themeColor: true,
      logoUrl: true,
      tenant: { select: { plan: true, brand: { select: { primaryColor: true } } } },
    },
  })
  if (!clinic) throw notFound('Clinic')
  return clinic
}

/** The clinic's Site row, created on first use with brand-coloured defaults. */
export async function ensureSite(clinicId: string) {
  const existing = await prisma.site.findUnique({ where: { clinicId } })
  if (existing) return existing
  const clinic = await clinicBrand(clinicId)
  const settings = defaultSiteSettings(clinic.themeColor ?? clinic.tenant.brand?.primaryColor)
  return prisma.site.upsert({
    where: { clinicId },
    create: { clinicId, settingsDraftJson: settings as unknown as Prisma.InputJsonValue },
    update: {},
  })
}

/** Everything the builder's overview screen needs. */
export async function getSiteForAdmin(clinicId: string) {
  const site = await ensureSite(clinicId)
  const clinic = await clinicBrand(clinicId)
  await ensureEntitySlugs(clinicId)
  await ensureDefaultSubdomain(clinicId)
  const primary = clinic.themeColor ?? clinic.tenant.brand?.primaryColor
  const draft = readSiteSettings(site.settingsDraftJson, primary)
  const published = site.settingsPublishedJson
    ? readSiteSettings(site.settingsPublishedJson, primary)
    : null
  const pageList = await pages.listPages(clinicId)
  return {
    id: site.id,
    clinic: { id: clinic.id, name: clinic.name, slug: clinic.slug, legacyLogoUrl: clinic.logoUrl },
    templateKey: site.templateKey,
    version: site.version,
    publishedAt: site.publishedAt,
    settings: draft,
    settingsPublished: published,
    hasUnpublishedSettings: JSON.stringify(draft) !== JSON.stringify(published),
    pages: pageList,
    urls: await siteBaseUrls(clinicId),
    entitlements: siteEntitlements(clinic.tenant.plan),
  }
}

export async function updateSettings(actor: SiteActor, raw: unknown) {
  const settings = parseSiteSettings(raw)
  const site = await ensureSite(actor.clinicId)
  await prisma.site.update({
    where: { clinicId: actor.clinicId },
    data: { settingsDraftJson: settings as unknown as Prisma.InputJsonValue },
  })
  await auditSite(actor, {
    entityType: 'Site',
    entityId: site.id,
    action: 'SITE_SETTINGS_SAVED',
    newValue: { fontPair: settings.theme.fontPair, navItems: settings.header.links.length },
  })
  return settings
}

/**
 * Publishes the site-wide settings and the chosen pages together, so a new
 * theme and the pages written for it go live at the same moment.
 */
export async function publishSite(actor: SiteActor, opts: { pageIds?: string[] | 'all' } = {}) {
  const { clinicId } = actor
  const site = await ensureSite(clinicId)
  const clinic = await clinicBrand(clinicId)
  const settings = parseSiteSettings(
    readSiteSettings(site.settingsDraftJson, clinic.themeColor ?? clinic.tenant.brand?.primaryColor)
  )
  const list = await pages.listPages(clinicId)
  const targets =
    opts.pageIds === 'all'
      ? // Live pages with pending edits, and pages never published yet. A page
        // someone deliberately took offline stays offline.
        list
          .filter((p) => (p.status === 'PUBLISHED' && p.hasUnpublishedChanges) || p.version === 0)
          .map((p) => p.id)
      : (opts.pageIds ?? []).filter((id) => list.some((p) => p.id === id))
  for (const id of targets) await pages.publishPage(actor, id)

  const updated = await prisma.site.update({
    where: { clinicId },
    data: {
      settingsPublishedJson: settings as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      publishedAt: new Date(),
    },
  })
  await auditSite(actor, {
    entityType: 'Site',
    entityId: site.id,
    action: 'SITE_PUBLISHED',
    newValue: { version: updated.version, pages: targets.length },
  })
  return getSiteForAdmin(clinicId)
}

export function listTemplates() {
  return SITE_TEMPLATES.map(templateSummary)
}

export function getTemplateDetail(key: string) {
  const t = getTemplate(key)
  if (!t) throw notFound('Template')
  return { ...templateSummary(t), settings: t.settings, pageBodies: t.pages }
}

/** Replaces `tpl_<slug>` page references with real page ids. */
function bindPageRefs<T>(value: T, idBySlug: Map<string, string>): T {
  const json = JSON.stringify(value).replace(/"pageId":"tpl_([a-z0-9-]+)"/g, (m, slug: string) => {
    const id = idBySlug.get(slug)
    return id ? `"pageId":"${id}"` : m
  })
  return JSON.parse(json) as T
}

/** Drops links to template pages that weren't installed (styles-only installs). */
function dropUnboundLinks(settings: SiteSettings): SiteSettings {
  const bound = (l: { link: { kind: string; pageId?: string } }) =>
    !(l.link.kind === 'page' && l.link.pageId?.startsWith('tpl_'))
  return {
    ...settings,
    header: {
      ...settings.header,
      links: settings.header.links.filter(bound),
      cta: settings.header.cta && bound(settings.header.cta) ? settings.header.cta : null,
    },
    footer: {
      ...settings.footer,
      columns: settings.footer.columns.map((c) => ({ ...c, links: c.links.filter(bound) })),
    },
    announcement:
      settings.announcement.link?.kind === 'page' &&
      settings.announcement.link.pageId.startsWith('tpl_')
        ? { ...settings.announcement, link: null }
        : settings.announcement,
  }
}

/**
 * Installs a template into the clinic's DRAFT (nothing goes live until
 * publish).
 *   replace     — theme, menus and every template page. Pages that already
 *                 exist get the template copy as their draft; any unpublished
 *                 edits are saved as a revision first, so nothing is lost.
 *   styles-only — theme tokens and header/footer layout only; pages untouched.
 */
export async function installTemplate(
  actor: SiteActor,
  key: string,
  mode: 'replace' | 'styles-only'
) {
  const template = getTemplate(key)
  if (!template) throw notFound('Template')
  const { clinicId } = actor
  const site = await ensureSite(clinicId)
  const clinic = await clinicBrand(clinicId)
  const current = readSiteSettings(
    site.settingsDraftJson,
    clinic.themeColor ?? clinic.tenant.brand?.primaryColor
  )

  if (mode === 'styles-only') {
    const next: SiteSettings = {
      ...current,
      theme: template.settings.theme,
      header: { ...current.header, variant: template.settings.header.variant },
      footer: { ...current.footer, variant: template.settings.footer.variant },
    }
    await prisma.site.update({
      where: { clinicId },
      data: { settingsDraftJson: next as unknown as Prisma.InputJsonValue, templateKey: key },
    })
    await auditSite(actor, {
      entityType: 'Site',
      entityId: site.id,
      action: 'SITE_TEMPLATE_INSTALLED',
      newValue: { template: key, mode },
    })
    return getSiteForAdmin(clinicId)
  }

  const existing = await prisma.sitePage.findMany({
    where: { clinicId },
    select: { id: true, slug: true },
  })
  const existingSlugs = new Set(existing.map((p) => p.slug))
  const adding = template.pages.filter((p) => !existingSlugs.has(p.slug)).length
  const { maxPages } = siteEntitlements(clinic.tenant.plan)
  if (existing.length + adding > maxPages) {
    throw siteError(
      402,
      'site_page_limit',
      `This template adds ${adding} pages; your plan allows ${maxPages} in total.`
    )
  }

  // 1. Make sure every template page exists (empty drafts for new ones).
  const idBySlug = new Map(existing.map((p) => [p.slug, p.id]))
  for (const tp of template.pages) {
    if (idBySlug.has(tp.slug)) continue
    const created = await prisma.sitePage.create({
      data: {
        clinicId,
        kind: tp.kind,
        slug: tp.slug,
        title: tp.title,
        draftTitle: tp.title,
        status: 'DRAFT',
        sectionsJson: [],
        draftSectionsJson: [],
        showInNav: tp.showInNav,
      },
      select: { id: true },
    })
    idBySlug.set(tp.slug, created.id)
  }

  // 2. Write the template copy into each page's draft, keeping unpublished work.
  let order = 10
  for (const tp of template.pages) {
    const pageId = idBySlug.get(tp.slug)!
    const page = await prisma.sitePage.findFirst({ where: { id: pageId, clinicId } })
    if (!page) continue
    const sections = bindPageRefs(
      tp.sections.map((s) => ({ id: newSectionId(), hidden: false, ...s })),
      idBySlug
    )
    const draftDiffers =
      JSON.stringify(page.draftSectionsJson) !== JSON.stringify(page.sectionsJson) &&
      Array.isArray(page.draftSectionsJson) &&
      page.draftSectionsJson.length > 0
    let version = page.version
    if (draftDiffers) {
      version += 1
      await prisma.sitePageRevision.create({
        data: {
          clinicId,
          pageId,
          version,
          title: page.draftTitle ?? page.title,
          sectionsJson: page.draftSectionsJson as Prisma.InputJsonValue,
          metaJson: { reason: 'before-template-install', template: key },
          publishedById: actor.userId,
        },
      })
    }
    await prisma.sitePage.update({
      where: { id: pageId, clinicId },
      data: {
        draftSectionsJson: parseSections(sections) as unknown as Prisma.InputJsonValue,
        draftTitle: tp.title,
        draftSeoTitle: tp.seoTitle ?? null,
        draftSeoDescription: tp.seoDescription ?? null,
        showInNav: tp.showInNav,
        navOrder: order,
        version,
      },
    })
    order += 10
  }

  // 3. Theme and menus, keeping the clinic's own brand assets and social links.
  const next: SiteSettings = bindPageRefs(
    {
      ...template.settings,
      brand: current.brand,
      social: current.social,
      seo: { ...template.settings.seo, ogImage: current.seo.ogImage },
    },
    idBySlug
  )
  await prisma.site.update({
    where: { clinicId },
    data: {
      settingsDraftJson: parseSiteSettings(
        dropUnboundLinks(next)
      ) as unknown as Prisma.InputJsonValue,
      templateKey: key,
    },
  })
  await auditSite(actor, {
    entityType: 'Site',
    entityId: site.id,
    action: 'SITE_TEMPLATE_INSTALLED',
    newValue: { template: key, mode, pages: template.pages.length, added: adding },
  })
  return getSiteForAdmin(clinicId)
}

export async function issuePreviewLink(actor: SiteActor, pageId: string) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId: actor.clinicId },
    select: { id: true },
  })
  if (!page) throw notFound('Page')
  const { token, expiresAt } = createPreviewToken(actor.clinicId, page.id)
  const urls = await siteBaseUrls(actor.clinicId)
  return {
    token,
    expiresAt,
    url: `${urls.canonical.replace(/\/+$/, '')}/preview/${page.id}?token=${encodeURIComponent(token)}`,
  }
}

/**
 * Clinic-site pages (B8.1). The editor writes only the draft columns
 * (draftSectionsJson, draftTitle, draftSeo*); publish copies them to the
 * live columns the public site reads, bumps the version and keeps a
 * revision. URL structure fields (slug, nav placement, noindex) take effect
 * immediately — a slug change on a published page leaves a 301 behind.
 */
import type { Prisma, SitePageKind } from '@prisma/client'
import prisma from '../../config/prisma'
import { parseSections, type Section } from '../content/sections'
import { upgradeSections } from '../content/legacy'
import { RESERVED_SITE_SEGMENTS, SITE_SLUG_RE } from '../routing/routeKeys'
import { buildSitePath } from '../routing/buildSitePath'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { siteEntitlements } from '../entitlements'
import { upsertAutoRedirect } from './redirectService'

export const MAX_REVISIONS_PER_PAGE = 25

/** Kinds that own a fixed system path, and so a fixed slug. */
const FIXED_SLUG: Partial<Record<SitePageKind, string>> = {
  HOME: 'home',
  SERVICES: 'services',
  TEAM: 'team',
  CONTACT: 'contact',
}

/** Site-relative path a page is served at. */
export function pagePath(kind: SitePageKind, slug: string): string {
  switch (kind) {
    case 'HOME':
      return buildSitePath('home')
    case 'SERVICES':
      return buildSitePath('services')
    case 'TEAM':
      return buildSitePath('team')
    case 'CONTACT':
      return buildSitePath('contact')
    case 'LEGAL':
      return buildSitePath('legal', { slug })
    case 'STANDARD':
      return buildSitePath('page', { slug })
  }
}

export function validatePageSlug(kind: SitePageKind, raw: string | undefined): string {
  const fixed = FIXED_SLUG[kind]
  if (fixed) return fixed
  const slug = (raw ?? '').trim().toLowerCase()
  if (!SITE_SLUG_RE.test(slug)) {
    throw siteError(
      422,
      'site_invalid_slug',
      'Page URLs use 1–62 lowercase letters, numbers and hyphens (no leading or trailing hyphen)'
    )
  }
  if (kind === 'STANDARD' && RESERVED_SITE_SEGMENTS.has(slug)) {
    throw siteError(422, 'site_reserved_slug', `"/${slug}" is reserved by the website`)
  }
  return slug
}

const PAGE_LIST_SELECT = {
  id: true,
  kind: true,
  slug: true,
  title: true,
  draftTitle: true,
  status: true,
  showInNav: true,
  navOrder: true,
  noindex: true,
  version: true,
  publishedAt: true,
  updatedAt: true,
  createdAt: true,
  sectionsJson: true,
  draftSectionsJson: true,
  seoTitle: true,
  draftSeoTitle: true,
  seoDescription: true,
  draftSeoDescription: true,
} satisfies Prisma.SitePageSelect

type PageRow = Prisma.SitePageGetPayload<{ select: typeof PAGE_LIST_SELECT }>

function hasUnpublishedChanges(p: PageRow): boolean {
  if (p.status !== 'PUBLISHED') return true
  return (
    JSON.stringify(p.sectionsJson) !== JSON.stringify(p.draftSectionsJson) ||
    (p.draftTitle ?? p.title) !== p.title ||
    (p.draftSeoTitle ?? null) !== (p.seoTitle ?? null) ||
    (p.draftSeoDescription ?? null) !== (p.seoDescription ?? null)
  )
}

function summary(p: PageRow) {
  return {
    id: p.id,
    kind: p.kind,
    slug: p.slug,
    path: pagePath(p.kind, p.slug),
    title: p.draftTitle ?? p.title,
    status: p.status,
    showInNav: p.showInNav,
    navOrder: p.navOrder,
    noindex: p.noindex,
    version: p.version,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    hasUnpublishedChanges: hasUnpublishedChanges(p),
  }
}

export async function listPages(clinicId: string) {
  const rows = await prisma.sitePage.findMany({
    where: { clinicId },
    orderBy: [{ navOrder: 'asc' }, { createdAt: 'asc' }],
    select: PAGE_LIST_SELECT,
  })
  const order: SitePageKind[] = ['HOME', 'SERVICES', 'TEAM', 'STANDARD', 'CONTACT', 'LEGAL']
  return rows
    .map(summary)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.navOrder - b.navOrder)
}

async function findPage(clinicId: string, id: string) {
  const page = await prisma.sitePage.findFirst({ where: { id, clinicId } })
  if (!page) throw notFound('Page')
  return page
}

/** The editor's view: draft content, upgraded to the current section format. */
export async function getPageForEditor(clinicId: string, id: string) {
  const p = await findPage(clinicId, id)
  return {
    ...summary(p),
    title: p.draftTitle ?? p.title,
    seoTitle: p.draftSeoTitle ?? p.seoTitle,
    seoDescription: p.draftSeoDescription ?? p.seoDescription,
    ogImageAssetId: p.ogImageAssetId,
    sections: upgradeSections(p.draftSectionsJson),
    live: {
      title: p.title,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      sections: upgradeSections(p.sectionsJson),
    },
  }
}

async function assertPageLimit(clinicId: string, adding = 1) {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId },
    select: { tenant: { select: { plan: true } } },
  })
  const { maxPages } = siteEntitlements(clinic?.tenant.plan)
  const count = await prisma.sitePage.count({ where: { clinicId } })
  if (count + adding > maxPages) {
    throw siteError(
      402,
      'site_page_limit',
      `Your plan allows ${maxPages} pages. Remove a page or upgrade to add more.`
    )
  }
}

export interface CreatePageInput {
  kind?: SitePageKind
  slug?: string
  title: string
  sections?: unknown[]
  seoTitle?: string | null
  seoDescription?: string | null
  showInNav?: boolean
}

export async function createPage(actor: SiteActor, input: CreatePageInput) {
  const { clinicId } = actor
  const kind = input.kind ?? 'STANDARD'
  const slug = validatePageSlug(kind, input.slug)
  const sections = parseSections(input.sections ?? [])
  await assertPageLimit(clinicId)
  const clash = await prisma.sitePage.findUnique({
    where: { clinicId_slug: { clinicId, slug } },
    select: { id: true },
  })
  if (clash) throw siteError(409, 'site_slug_taken', 'A page already uses that URL')

  const title = input.title.trim()
  const page = await prisma.sitePage.create({
    data: {
      clinicId,
      kind,
      slug,
      title,
      draftTitle: title,
      status: 'DRAFT',
      draftSectionsJson: sections as unknown as Prisma.InputJsonValue,
      sectionsJson: [],
      draftSeoTitle: input.seoTitle ?? null,
      draftSeoDescription: input.seoDescription ?? null,
      showInNav: input.showInNav ?? kind === 'STANDARD',
      navOrder: await nextNavOrder(clinicId),
    },
  })
  await auditSite(actor, {
    entityType: 'SitePage',
    entityId: page.id,
    action: 'SITE_PAGE_CREATED',
    newValue: { kind, slug, sections: sections.length },
  })
  return getPageForEditor(clinicId, page.id)
}

async function nextNavOrder(clinicId: string): Promise<number> {
  const last = await prisma.sitePage.findFirst({
    where: { clinicId },
    orderBy: { navOrder: 'desc' },
    select: { navOrder: true },
  })
  return (last?.navOrder ?? 0) + 10
}

export interface UpdatePageInput {
  title?: string
  slug?: string
  sections?: unknown[]
  seoTitle?: string | null
  seoDescription?: string | null
  ogImageAssetId?: string | null
  showInNav?: boolean
  navOrder?: number
  noindex?: boolean
}

export async function updatePageDraft(actor: SiteActor, id: string, input: UpdatePageInput) {
  const { clinicId } = actor
  const page = await findPage(clinicId, id)
  const data: Prisma.SitePageUpdateInput = {}
  const changed: string[] = []

  if (input.sections !== undefined) {
    data.draftSectionsJson = parseSections(input.sections) as unknown as Prisma.InputJsonValue
    changed.push('sections')
  }
  if (input.title !== undefined) {
    data.draftTitle = input.title.trim()
    changed.push('title')
  }
  if (input.seoTitle !== undefined) {
    data.draftSeoTitle = input.seoTitle
    changed.push('seoTitle')
  }
  if (input.seoDescription !== undefined) {
    data.draftSeoDescription = input.seoDescription
    changed.push('seoDescription')
  }
  if (input.ogImageAssetId !== undefined) {
    data.ogImageAssetId = input.ogImageAssetId
    changed.push('ogImage')
  }
  if (input.showInNav !== undefined) data.showInNav = input.showInNav
  if (input.navOrder !== undefined) data.navOrder = input.navOrder
  if (input.noindex !== undefined) data.noindex = input.noindex

  let oldPath: string | null = null
  if (input.slug !== undefined) {
    const slug = validatePageSlug(page.kind, input.slug)
    if (slug !== page.slug) {
      const clash = await prisma.sitePage.findUnique({
        where: { clinicId_slug: { clinicId, slug } },
        select: { id: true },
      })
      if (clash) throw siteError(409, 'site_slug_taken', 'A page already uses that URL')
      data.slug = slug
      oldPath = page.status === 'PUBLISHED' ? pagePath(page.kind, page.slug) : null
      changed.push('slug')
    }
  }

  const updated = await prisma.sitePage.update({ where: { id: page.id, clinicId }, data })
  if (oldPath) await upsertAutoRedirect(clinicId, oldPath, pagePath(updated.kind, updated.slug))
  if (changed.length) {
    await auditSite(actor, {
      entityType: 'SitePage',
      entityId: page.id,
      action: 'SITE_PAGE_DRAFT_SAVED',
      fieldChanged: changed.join(','),
      ...(changed.includes('slug') ? { oldValue: page.slug, newValue: updated.slug } : {}),
    })
  }
  return getPageForEditor(clinicId, page.id)
}

export async function publishPage(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const page = await findPage(clinicId, id)
  // Re-validate on publish: the draft may predate a schema change.
  const sections: Section[] = parseSections(upgradeSections(page.draftSectionsJson))
  const version = page.version + 1
  const title = page.draftTitle ?? page.title

  await prisma.$transaction(async (tx) => {
    await tx.sitePage.update({
      where: { id: page.id, clinicId },
      data: {
        sectionsJson: sections as unknown as Prisma.InputJsonValue,
        draftSectionsJson: sections as unknown as Prisma.InputJsonValue,
        title,
        seoTitle: page.draftSeoTitle,
        seoDescription: page.draftSeoDescription,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version,
      },
    })
    await tx.sitePageRevision.create({
      data: {
        clinicId,
        pageId: page.id,
        version,
        title,
        sectionsJson: sections as unknown as Prisma.InputJsonValue,
        metaJson: { seoTitle: page.draftSeoTitle, seoDescription: page.draftSeoDescription },
        publishedById: actor.userId,
      },
    })
    const old = await tx.sitePageRevision.findMany({
      where: { clinicId, pageId: page.id },
      orderBy: { version: 'desc' },
      skip: MAX_REVISIONS_PER_PAGE,
      select: { id: true },
    })
    if (old.length) {
      await tx.sitePageRevision.deleteMany({
        where: { clinicId, id: { in: old.map((r) => r.id) } },
      })
    }
  })
  await auditSite(actor, {
    entityType: 'SitePage',
    entityId: page.id,
    action: 'SITE_PAGE_PUBLISHED',
    newValue: { slug: page.slug, version, sections: sections.length },
  })
  return getPageForEditor(clinicId, page.id)
}

export async function unpublishPage(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const page = await findPage(clinicId, id)
  await prisma.sitePage.update({
    where: { id: page.id, clinicId },
    // The live copy is cleared so nothing stale can ever be served again.
    data: { status: 'DRAFT', publishedAt: null, sectionsJson: [] },
  })
  await auditSite(actor, {
    entityType: 'SitePage',
    entityId: page.id,
    action: 'SITE_PAGE_UNPUBLISHED',
    oldValue: { slug: page.slug, version: page.version },
  })
  return getPageForEditor(clinicId, page.id)
}

export async function deletePage(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const page = await findPage(clinicId, id)
  if (page.kind === 'HOME') {
    throw siteError(409, 'site_home_required', 'The home page can be edited but not deleted')
  }
  await prisma.sitePage.delete({ where: { id: page.id, clinicId } })
  await auditSite(actor, {
    entityType: 'SitePage',
    entityId: page.id,
    action: 'SITE_PAGE_DELETED',
    oldValue: { kind: page.kind, slug: page.slug, version: page.version },
  })
}

export async function duplicatePage(actor: SiteActor, id: string) {
  const { clinicId } = actor
  const page = await findPage(clinicId, id)
  if (page.kind !== 'STANDARD' && page.kind !== 'LEGAL') {
    throw siteError(409, 'site_page_unique', 'This page type exists once per site')
  }
  let slug = `${page.slug.slice(0, 55)}-copy`
  for (
    let n = 2;
    await prisma.sitePage.findUnique({ where: { clinicId_slug: { clinicId, slug } } });
    n++
  ) {
    slug = `${page.slug.slice(0, 52)}-copy-${n}`
  }
  return createPage(actor, {
    kind: page.kind,
    slug,
    title: `${page.draftTitle ?? page.title} (copy)`,
    sections: upgradeSections(page.draftSectionsJson).map((s) => ({ ...s, id: s.id })),
    seoTitle: page.draftSeoTitle,
    seoDescription: page.draftSeoDescription,
    showInNav: false,
  })
}

export async function listRevisions(clinicId: string, pageId: string) {
  await findPage(clinicId, pageId)
  return prisma.sitePageRevision.findMany({
    where: { clinicId, pageId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, title: true, publishedById: true, createdAt: true },
  })
}

/** Copies a published revision back into the draft (publish to make it live). */
export async function restoreRevision(actor: SiteActor, pageId: string, version: number) {
  const { clinicId } = actor
  const page = await findPage(clinicId, pageId)
  const rev = await prisma.sitePageRevision.findFirst({
    where: { clinicId, pageId: page.id, version },
  })
  if (!rev) throw notFound('Revision')
  const meta = (rev.metaJson ?? {}) as { seoTitle?: string | null; seoDescription?: string | null }
  await prisma.sitePage.update({
    where: { id: page.id, clinicId },
    data: {
      draftSectionsJson: upgradeSections(rev.sectionsJson) as unknown as Prisma.InputJsonValue,
      draftTitle: rev.title,
      draftSeoTitle: meta.seoTitle ?? null,
      draftSeoDescription: meta.seoDescription ?? null,
    },
  })
  await auditSite(actor, {
    entityType: 'SitePage',
    entityId: page.id,
    action: 'SITE_PAGE_RESTORED',
    newValue: { version },
  })
  return getPageForEditor(clinicId, page.id)
}

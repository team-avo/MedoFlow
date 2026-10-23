/**
 * URL slugs for services, providers and products — the <slug> in
 * /services/<slug>, /team/<slug> and /store/<slug>. A slug is assigned once
 * (on create, or lazily for older rows) and only changes when an admin edits
 * it; every change leaves a 301 redirect behind.
 */
import crypto from 'crypto'
import prisma from '../../config/prisma'
import { SITE_SLUG_RE } from '../routing/routeKeys'
import { buildSitePath } from '../routing/buildSitePath'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { upsertAutoRedirect } from './redirectService'

export type SluggedEntity = 'service' | 'provider' | 'product'

/** Same rules as the SQL backfill in migration 20261020000000. */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return s || 'item'
}

async function slugTaken(
  entity: SluggedEntity,
  clinicId: string,
  slug: string,
  excludeId?: string
): Promise<boolean> {
  const where = { clinicId, slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }
  const hit =
    entity === 'service'
      ? await prisma.service.findFirst({ where, select: { id: true } })
      : entity === 'provider'
        ? await prisma.provider.findFirst({ where, select: { id: true } })
        : await prisma.product.findFirst({ where, select: { id: true } })
  return Boolean(hit)
}

/** A free slug for `text` within the clinic ("dr-lee", then "dr-lee-2", …). */
export async function uniqueEntitySlug(
  entity: SluggedEntity,
  clinicId: string,
  text: string,
  excludeId?: string
): Promise<string> {
  const base = slugify(text)
  if (!(await slugTaken(entity, clinicId, base, excludeId))) return base
  for (let n = 2; n < 50; n++) {
    const candidate = `${base.slice(0, 56)}-${n}`
    if (!(await slugTaken(entity, clinicId, candidate, excludeId))) return candidate
  }
  return `${base.slice(0, 52)}-${crypto.randomBytes(4).toString('hex')}`
}

/** Gives every service/provider/product of a clinic that lacks a slug one. */
export async function ensureEntitySlugs(clinicId: string): Promise<number> {
  let assigned = 0
  const services = await prisma.service.findMany({
    where: { clinicId, slug: null },
    select: { id: true, name: true },
  })
  for (const s of services) {
    const slug = await uniqueEntitySlug('service', clinicId, s.name, s.id)
    await prisma.service.update({ where: { id: s.id, clinicId }, data: { slug } })
    assigned++
  }
  const providers = await prisma.provider.findMany({
    where: { clinicId, slug: null },
    select: { id: true, firstName: true, lastName: true },
  })
  for (const p of providers) {
    const slug = await uniqueEntitySlug('provider', clinicId, `${p.firstName} ${p.lastName}`, p.id)
    await prisma.provider.update({ where: { id: p.id, clinicId }, data: { slug } })
    assigned++
  }
  const products = await prisma.product.findMany({
    where: { clinicId, slug: null },
    select: { id: true, name: true },
  })
  for (const p of products) {
    const slug = await uniqueEntitySlug('product', clinicId, p.name, p.id)
    await prisma.product.update({ where: { id: p.id, clinicId }, data: { slug } })
    assigned++
  }
  return assigned
}

const ROUTE_FOR: Record<SluggedEntity, 'service' | 'provider' | 'product'> = {
  service: 'service',
  provider: 'provider',
  product: 'product',
}

/** Admin edit of an entity's URL slug; the old URL 301s to the new one. */
export async function setEntitySlug(
  actor: SiteActor,
  entity: SluggedEntity,
  id: string,
  rawSlug: string
): Promise<{ id: string; slug: string }> {
  const slug = rawSlug.trim().toLowerCase()
  // Entity slugs live under /services/, /team/ or /store/, so top-level
  // reserved words don't apply to them.
  if (!SITE_SLUG_RE.test(slug)) {
    throw siteError(422, 'site_invalid_slug', 'Use lowercase letters, numbers and hyphens')
  }
  const { clinicId } = actor
  const current =
    entity === 'service'
      ? await prisma.service.findFirst({ where: { id, clinicId }, select: { slug: true } })
      : entity === 'provider'
        ? await prisma.provider.findFirst({ where: { id, clinicId }, select: { slug: true } })
        : await prisma.product.findFirst({ where: { id, clinicId }, select: { slug: true } })
  if (!current) throw notFound(entity)
  if (current.slug === slug) return { id, slug }
  if (await slugTaken(entity, clinicId, slug, id)) {
    throw siteError(409, 'site_slug_taken', 'Another item already uses that URL')
  }
  if (entity === 'service') await prisma.service.update({ where: { id, clinicId }, data: { slug } })
  else if (entity === 'provider') {
    await prisma.provider.update({ where: { id, clinicId }, data: { slug } })
  } else await prisma.product.update({ where: { id, clinicId }, data: { slug } })

  if (current.slug) {
    const key = ROUTE_FOR[entity]
    await upsertAutoRedirect(
      clinicId,
      buildSitePath(key, { slug: current.slug }),
      buildSitePath(key, { slug })
    )
  }
  await auditSite(actor, {
    entityType: entity === 'service' ? 'Service' : entity === 'provider' ? 'Provider' : 'Product',
    entityId: id,
    action: 'SITE_SLUG_CHANGED',
    fieldChanged: 'slug',
    oldValue: current.slug,
    newValue: slug,
  })
  return { id, slug }
}

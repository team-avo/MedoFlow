/**
 * Clinic-site URL redirects (B8.5). Checked by the renderer only when a path
 * has no live content, so a redirect can never hide a published page.
 * Chains are collapsed on write (A→B, B→C becomes A→C, B→C) and loops are
 * refused, so a lookup is always a single hop.
 */
import prisma from '../../config/prisma'
import { normalizeSitePath } from '../routing/matchSitePath'
import { isSafeExternalHref } from '../content/primitives'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'

export const MAX_REDIRECTS_PER_SITE = 500

function cleanFrom(raw: string): string {
  const p = normalizeSitePath(raw.trim())
  if (!p || p === '/' || p.length > 300) {
    throw siteError(422, 'site_invalid_redirect', 'The old path must be a path like /our-team')
  }
  return p
}

function cleanTo(raw: string): string {
  const v = raw.trim()
  if (/^https:\/\//i.test(v)) {
    if (!isSafeExternalHref(v)) throw siteError(422, 'site_invalid_redirect', 'Invalid target URL')
    return v
  }
  const p = normalizeSitePath(v)
  if (!p || !v.startsWith('/') || p.length > 300) {
    throw siteError(422, 'site_invalid_redirect', 'The new path must start with / or https://')
  }
  return p
}

/** Where a request for `path` should go, or null. */
export async function findRedirect(
  clinicId: string,
  path: string
): Promise<{ toPath: string; code: number } | null> {
  const r = await prisma.siteRedirect.findUnique({
    where: { clinicId_fromPath: { clinicId, fromPath: path } },
    select: { toPath: true, code: true },
  })
  return r
}

/** Written when a slug changes: old → new, collapsing any chain into `from`. */
export async function upsertAutoRedirect(clinicId: string, from: string, to: string) {
  if (from === to) return
  // The new path is live again: it must not redirect anywhere.
  await prisma.siteRedirect.deleteMany({ where: { clinicId, fromPath: to } })
  // Anything that pointed at the old path now points straight at the new one.
  await prisma.siteRedirect.updateMany({ where: { clinicId, toPath: from }, data: { toPath: to } })
  await prisma.siteRedirect.upsert({
    where: { clinicId_fromPath: { clinicId, fromPath: from } },
    create: { clinicId, fromPath: from, toPath: to, code: 301, auto: true },
    update: { toPath: to, code: 301, auto: true },
  })
}

export async function listRedirects(clinicId: string) {
  return prisma.siteRedirect.findMany({
    where: { clinicId },
    orderBy: [{ auto: 'asc' }, { fromPath: 'asc' }],
    select: { id: true, fromPath: true, toPath: true, code: true, auto: true, createdAt: true },
  })
}

export async function createRedirect(
  actor: SiteActor,
  input: { fromPath: string; toPath: string; code?: 301 | 302 }
) {
  const { clinicId } = actor
  const fromPath = cleanFrom(input.fromPath)
  let toPath = cleanTo(input.toPath)
  if (fromPath === toPath)
    throw siteError(422, 'site_redirect_loop', 'A path cannot redirect to itself')

  const count = await prisma.siteRedirect.count({ where: { clinicId } })
  if (count >= MAX_REDIRECTS_PER_SITE) {
    throw siteError(
      422,
      'site_redirect_limit',
      `A site can have at most ${MAX_REDIRECTS_PER_SITE} redirects`
    )
  }
  // Collapse: if the target itself redirects, point at its final destination.
  if (toPath.startsWith('/')) {
    const next = await findRedirect(clinicId, toPath)
    if (next) toPath = next.toPath
    if (toPath === fromPath) {
      throw siteError(422, 'site_redirect_loop', 'That redirect would create a loop')
    }
  }
  const existing = await findRedirect(clinicId, fromPath)
  if (existing) throw siteError(409, 'site_redirect_exists', 'That path already redirects')

  const row = await prisma.siteRedirect.create({
    data: { clinicId, fromPath, toPath, code: input.code ?? 301, auto: false },
    select: { id: true, fromPath: true, toPath: true, code: true, auto: true, createdAt: true },
  })
  // Existing redirects into the new source now skip straight to its target.
  await prisma.siteRedirect.updateMany({
    where: { clinicId, toPath: fromPath },
    data: { toPath },
  })
  await auditSite(actor, {
    entityType: 'SiteRedirect',
    entityId: row.id,
    action: 'SITE_REDIRECT_CREATED',
    newValue: { fromPath, toPath, code: row.code },
  })
  return row
}

/** CSV import: "old,new" per line. Returns per-line results; never partial-fails silently. */
export async function importRedirects(actor: SiteActor, csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)
  const results: { line: number; fromPath: string; ok: boolean; error?: string }[] = []
  for (const [i, line] of lines.entries()) {
    const [from = '', to = ''] = line.split(',').map((s) => s.trim())
    if (i === 0 && /^(from|old)/i.test(from)) continue // header row
    try {
      await createRedirect(actor, { fromPath: from, toPath: to })
      results.push({ line: i + 1, fromPath: from, ok: true })
    } catch (e) {
      results.push({ line: i + 1, fromPath: from, ok: false, error: (e as Error).message })
    }
  }
  return results
}

export async function deleteRedirect(actor: SiteActor, id: string) {
  const row = await prisma.siteRedirect.findFirst({
    where: { id, clinicId: actor.clinicId },
    select: { id: true, fromPath: true, toPath: true },
  })
  if (!row) throw notFound('Redirect')
  await prisma.siteRedirect.delete({ where: { id: row.id, clinicId: actor.clinicId } })
  await auditSite(actor, {
    entityType: 'SiteRedirect',
    entityId: row.id,
    action: 'SITE_REDIRECT_DELETED',
    oldValue: { fromPath: row.fromPath, toPath: row.toPath },
  })
}

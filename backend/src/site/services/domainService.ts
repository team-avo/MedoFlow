/**
 * Clinic-site domains (B8.2): the free <label>.<root> subdomain every clinic
 * gets, and clinic-owned custom domains that serve the site once verified.
 * Exactly one domain per clinic is primary — the canonical origin for
 * links, the sitemap and SEO; every other host 301s to it.
 */
import crypto from 'crypto'
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import { RESERVED_SITE_LABELS, siteRootDomain, subdomainsEnabled } from '../config'
import { siteEntitlements } from '../entitlements'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { getDomainProvider, type DnsRecord } from '../domainProvider'
import { ownershipRecord, routingRecord } from '../domainProvider/manual'
import { classifyHost, isIpv4, normalizeHost, siteOrigin, subdomainHost } from '../routing/hosts'
import { invalidateHostCache } from './hostService'

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

/** Platform suffixes a clinic can never claim as "its" domain. */
const PLATFORM_SUFFIXES = ['workers.dev', 'pages.dev', 'onrender.com', 'vercel.app', 'localhost']

function frontendOrigin(): string {
  return (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(
    /\/+$/,
    ''
  )
}

type DomainRow = Awaited<ReturnType<typeof prisma.siteDomain.findMany>>[number]

export function domainHost(d: Pick<DomainRow, 'kind' | 'hostname'>): string {
  return d.kind === 'SUBDOMAIN' ? subdomainHost(d.hostname) : d.hostname
}

/** Public URLs of a clinic's site; `canonical` is where every alias points. */
export async function siteBaseUrls(clinicId: string) {
  const [domains, clinic] = await Promise.all([
    prisma.siteDomain.findMany({ where: { clinicId }, orderBy: { createdAt: 'asc' } }),
    prisma.clinic.findFirst({ where: { id: clinicId }, select: { slug: true } }),
  ])
  const live = domains.filter(
    (d) => d.status === 'VERIFIED' && (d.kind === 'CUSTOM' || subdomainsEnabled())
  )
  const primary =
    live.find((d) => d.isPrimary) ??
    live.find((d) => d.kind === 'SUBDOMAIN') ??
    live.find((d) => d.kind === 'CUSTOM') ??
    null
  const appPath = clinic?.slug ? `${frontendOrigin()}/s/${clinic.slug}` : null
  const sub = live.find((d) => d.kind === 'SUBDOMAIN')
  const canonicalKind: 'domain' | 'app' = primary ? 'domain' : 'app'
  return {
    canonical: primary ? siteOrigin(domainHost(primary)) : (appPath ?? frontendOrigin()),
    /** 'domain' once the site has a live host of its own; 'app' = <app>/s/<slug>. */
    canonicalKind,
    subdomain: sub ? siteOrigin(domainHost(sub)) : null,
    appPath,
    custom: live.filter((d) => d.kind === 'CUSTOM').map((d) => siteOrigin(d.hostname)),
  }
}

function publicDomain(d: DomainRow) {
  return {
    id: d.id,
    kind: d.kind,
    hostname: domainHost(d),
    status: d.status,
    isPrimary: d.isPrimary,
    sslStatus: d.sslStatus,
    lastError: d.lastError,
    lastCheckedAt: d.lastCheckedAt,
    verifiedAt: d.verifiedAt,
    url: siteOrigin(domainHost(d)),
    records: d.kind === 'CUSTOM' ? dnsRecordsFor(d) : [],
  }
}

function dnsRecordsFor(d: DomainRow): DnsRecord[] {
  return [routingRecord(d.hostname), ownershipRecord(d.hostname, d.verifyToken ?? '')]
}

export async function listDomains(clinicId: string) {
  await ensureDefaultSubdomain(clinicId)
  const rows = await prisma.siteDomain.findMany({
    where: { clinicId },
    orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }],
  })
  return { rootDomain: siteRootDomain(), domains: rows.map(publicDomain) }
}

/** Every clinic gets <slug>.<root> as soon as it has a usable slug. */
export async function ensureDefaultSubdomain(clinicId: string): Promise<void> {
  const has = await prisma.siteDomain.findFirst({
    where: { clinicId, kind: 'SUBDOMAIN' },
    select: { id: true },
  })
  if (has) return
  const clinic = await prisma.clinic.findFirst({ where: { id: clinicId }, select: { slug: true } })
  const label = clinic?.slug
  if (!label || !LABEL_RE.test(label) || RESERVED_SITE_LABELS.has(label)) return
  const taken = await withTenantBypass('site.subdomain_availability', () =>
    prisma.siteDomain.findUnique({ where: { hostname: label }, select: { id: true } })
  )
  if (taken) return
  const anyPrimary = await prisma.siteDomain.findFirst({
    where: { clinicId, isPrimary: true },
    select: { id: true },
  })
  await prisma.siteDomain.create({
    data: {
      clinicId,
      hostname: label,
      kind: 'SUBDOMAIN',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      isPrimary: !anyPrimary,
    },
  })
  invalidateHostCache()
}

/** Is `label` free to use as a clinic subdomain? (signup + rename) */
export async function isSubdomainAvailable(label: string, exceptClinicId?: string) {
  if (!LABEL_RE.test(label) || RESERVED_SITE_LABELS.has(label)) return false
  const row = await withTenantBypass('site.subdomain_availability', () =>
    prisma.siteDomain.findUnique({ where: { hostname: label }, select: { clinicId: true } })
  )
  return !row || row.clinicId === exceptClinicId
}

/** Renames the clinic's subdomain; the old one keeps working as an alias for SEO. */
export async function changeSubdomain(actor: SiteActor, rawLabel: string) {
  const label = rawLabel.trim().toLowerCase()
  if (!(await isSubdomainAvailable(label, actor.clinicId))) {
    throw siteError(409, 'site_subdomain_taken', 'That subdomain is not available')
  }
  const { clinicId } = actor
  const subs = await prisma.siteDomain.findMany({
    where: { clinicId, kind: 'SUBDOMAIN' },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  const current = subs[0] ?? null
  if (current?.hostname === label) return listDomains(clinicId)
  const anyPrimary = await prisma.siteDomain.count({ where: { clinicId, isPrimary: true } })
  // The new label inherits primary status; the old one stays as an alias.
  const makePrimary = current ? current.isPrimary : anyPrimary === 0
  if (current?.isPrimary) {
    await prisma.siteDomain.update({
      where: { id: current.id, clinicId },
      data: { isPrimary: false },
    })
  }
  const existing = subs.find((d) => d.hostname === label)
  const row = existing
    ? await prisma.siteDomain.update({
        where: { id: existing.id, clinicId },
        data: { isPrimary: makePrimary },
      })
    : await prisma.siteDomain.create({
        data: {
          clinicId,
          hostname: label,
          kind: 'SUBDOMAIN',
          status: 'VERIFIED',
          verifiedAt: new Date(),
          isPrimary: makePrimary,
        },
      })
  invalidateHostCache()
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_SUBDOMAIN_CHANGED',
    oldValue: current?.hostname ?? null,
    newValue: label,
  })
  return listDomains(actor.clinicId)
}

/** Lowercase ASCII hostname a clinic may connect, or a 422. */
export function validateCustomHostname(raw: string): string {
  const host = normalizeHost(raw)
  const invalid = (msg: string) => siteError(422, 'site_invalid_domain', msg)
  if (!host || !host.includes('.')) throw invalid('Enter a domain like www.yourclinic.com')
  if (isIpv4(host)) throw invalid('Use a domain name, not an IP address')
  const tld = host.split('.').pop()!
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]{2,59}$/.test(tld))
    throw invalid('That domain has no valid ending')
  const root = siteRootDomain()
  if (host === root || host.endsWith(`.${root}`)) {
    throw invalid(`Domains under ${root} are assigned automatically`)
  }
  if (PLATFORM_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw invalid('That domain belongs to a hosting platform')
  }
  if (classifyHost(host).mode !== 'site-custom') throw invalid('That domain cannot be connected')
  return host
}

export async function addCustomDomain(actor: SiteActor, raw: string) {
  const hostname = validateCustomHostname(raw)
  const { clinicId } = actor
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId },
    select: { tenant: { select: { plan: true } } },
  })
  const { maxCustomDomains } = siteEntitlements(clinic?.tenant.plan)
  const count = await prisma.siteDomain.count({ where: { clinicId, kind: 'CUSTOM' } })
  if (count >= maxCustomDomains) {
    throw siteError(
      402,
      'site_domain_plan',
      maxCustomDomains === 0
        ? 'Custom domains are available on paid plans'
        : `Your plan includes ${maxCustomDomains} custom domain(s)`
    )
  }
  const taken = await withTenantBypass('site.domain_uniqueness', () =>
    prisma.siteDomain.findUnique({ where: { hostname }, select: { id: true } })
  )
  if (taken) throw siteError(409, 'site_domain_taken', 'That domain is already connected to a site')

  const verifyToken = crypto.randomBytes(16).toString('hex')
  const reg = await getDomainProvider().register({ hostname, verifyToken, providerRef: null })
  const row = await prisma.siteDomain.create({
    data: {
      clinicId,
      hostname,
      kind: 'CUSTOM',
      status: 'PENDING',
      verifyToken,
      providerRef: reg.providerRef,
      sslStatus: reg.sslStatus,
    },
  })
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_DOMAIN_ADDED',
    newValue: { hostname, provider: getDomainProvider().name },
  })
  return { ...publicDomain(row), records: reg.records }
}

async function findCustom(clinicId: string, id: string) {
  const row = await prisma.siteDomain.findFirst({ where: { id, clinicId } })
  if (!row) throw notFound('Domain')
  return row
}

export async function verifyDomain(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.kind !== 'CUSTOM') return publicDomain(row)
  const check = await getDomainProvider().check({
    hostname: row.hostname,
    verifyToken: row.verifyToken ?? '',
    providerRef: row.providerRef,
  })
  const becameVerified = check.status === 'VERIFIED' && row.status !== 'VERIFIED'
  const updated = await prisma.siteDomain.update({
    where: { id: row.id, clinicId: actor.clinicId },
    data: {
      status: check.status,
      sslStatus: check.sslStatus,
      lastError: check.error,
      lastCheckedAt: new Date(),
      ...(becameVerified ? { verifiedAt: new Date() } : {}),
    },
  })
  invalidateHostCache()
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: check.status === 'VERIFIED' ? 'SITE_DOMAIN_VERIFIED' : 'SITE_DOMAIN_CHECK_FAILED',
    newValue: { hostname: row.hostname, status: check.status },
  })
  return {
    ...publicDomain(updated),
    records: check.records.length ? check.records : dnsRecordsFor(updated),
  }
}

export async function setPrimaryDomain(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.status !== 'VERIFIED') {
    throw siteError(409, 'site_domain_unverified', 'Verify the domain before making it primary')
  }
  await prisma.siteDomain.updateMany({
    where: { clinicId: actor.clinicId, isPrimary: true },
    data: { isPrimary: false },
  })
  await prisma.siteDomain.update({
    where: { id: row.id, clinicId: actor.clinicId },
    data: { isPrimary: true },
  })
  invalidateHostCache()
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_DOMAIN_PRIMARY',
    newValue: { hostname: domainHost(row) },
  })
  return listDomains(actor.clinicId)
}

export async function removeDomain(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.kind === 'SUBDOMAIN') {
    const subs = await prisma.siteDomain.count({
      where: { clinicId: actor.clinicId, kind: 'SUBDOMAIN' },
    })
    if (subs <= 1)
      throw siteError(409, 'site_subdomain_required', 'A site keeps at least one subdomain')
  }
  if (row.kind === 'CUSTOM') {
    await getDomainProvider().remove({
      hostname: row.hostname,
      verifyToken: row.verifyToken ?? '',
      providerRef: row.providerRef,
    })
  }
  await prisma.siteDomain.delete({ where: { id: row.id, clinicId: actor.clinicId } })
  if (row.isPrimary) {
    const fallback = await prisma.siteDomain.findFirst({
      where: { clinicId: actor.clinicId, kind: 'SUBDOMAIN', status: 'VERIFIED' },
      // The newest label is the clinic's current name (renames keep old ones as aliases).
      orderBy: { createdAt: 'desc' },
    })
    if (fallback) {
      await prisma.siteDomain.update({
        where: { id: fallback.id, clinicId: actor.clinicId },
        data: { isPrimary: true },
      })
    }
  }
  invalidateHostCache()
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_DOMAIN_REMOVED',
    oldValue: { hostname: domainHost(row) },
  })
  return listDomains(actor.clinicId)
}

/**
 * Clinic-site domains (B8.2): the free <label>.<root> subdomain every clinic
 * gets, and clinic-owned custom domains that serve the site once verified.
 * Exactly one domain per clinic is primary, the canonical origin for
 * links, the sitemap and SEO; every other host 301s to it.
 */
import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import { RESERVED_SITE_LABELS, siteCnameTarget, siteRootDomain, subdomainsEnabled } from '../config'
import { siteEntitlements } from '../entitlements'
import { siteError, notFound } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { getDomainProvider, type DnsRecord, type DomainCheck } from '../domainProvider'
import {
  detectDnsProvider,
  dnsProviderLabel,
  findZone,
  ownershipRecord,
  relativeHost,
  routingRecord,
} from '../domainProvider/diagnose'
import { httpsProbe } from '../domainProvider/probe'
import { isCapacityError } from '../domainProvider/pages'
import { PagesError } from '../frontDoor/cfApi'
import {
  buildApplyUrl,
  connectState,
  discover,
  domainConnectConfig,
  verifyConnectState,
} from '../domainConnect'
import { classifyHost, isIpv4, normalizeHost, siteOrigin, subdomainHost } from '../routing/hosts'
import { invalidateHostCache } from './hostService'
import { platformAlertRecipients } from './platformAlert'
import { logAudit } from '../../services/auditService'
import { sendDomainCapacityEmail } from '../../services/emailService'

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

/** CTO-38 connection stages, in order (error is a dead end the team must look at). */
export type DomainStage = 'dns' | 'verified' | 'ssl' | 'live' | 'error'

function publicDomain(d: DomainRow, records?: DnsRecord[]) {
  return {
    id: d.id,
    kind: d.kind,
    hostname: domainHost(d),
    status: d.status,
    // Subdomains are served by the front door from the start.
    stage: (d.kind === 'SUBDOMAIN' ? 'live' : d.stage) as DomainStage,
    isPrimary: d.isPrimary,
    sslStatus: d.sslStatus,
    lastError: d.lastError,
    lastCheckedAt: d.lastCheckedAt,
    verifiedAt: d.verifiedAt,
    liveAt: d.liveAt,
    zone: d.zone,
    dnsProvider: d.dnsProvider
      ? { key: d.dnsProvider, name: dnsProviderLabel(d.dnsProvider) ?? d.dnsProvider }
      : null,
    checks: d.kind === 'CUSTOM' && Array.isArray(d.checks) ? d.checks : [],
    url: siteOrigin(domainHost(d)),
    records: d.kind === 'CUSTOM' ? withHosts(records ?? dnsRecordsFor(d), d.zone) : [],
  }
}

function dnsRecordsFor(d: DomainRow): DnsRecord[] {
  return [routingRecord(d.hostname), ownershipRecord(d.hostname, d.verifyToken ?? '')]
}

/** Adds the zone-relative host (what DNS providers ask for) to each record. */
function withHosts(records: DnsRecord[], zone: string | null): DnsRecord[] {
  return records.map((r) => {
    const host = r.host ?? relativeHost(r.name, zone)
    return host ? { ...r, host } : r
  })
}

/** Rows written by a person carry their actor; background checks are system rows. */
function auditDomain(
  actor: SiteActor | null,
  clinicId: string,
  entry: Parameters<typeof auditSite>[1]
): Promise<void> {
  if (actor) return auditSite(actor, entry)
  return logAudit({ clinicId, performedById: null, ...entry })
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms).unref())])

export async function listDomains(clinicId: string) {
  await ensureDefaultSubdomain(clinicId)
  const rows = await prisma.siteDomain.findMany({
    where: { clinicId },
    orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }],
  })
  return { rootDomain: siteRootDomain(), domains: rows.map((r) => publicDomain(r)) }
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
  // CTO-38: which zone is this, and who runs its DNS? (best effort, 5 s)
  const provider = getDomainProvider()
  const found = await withTimeout(
    findZone(hostname).catch(() => null),
    5_000
  )
  const zone = found?.zone ?? null
  const apex = zone ? zone === hostname : hostname.split('.').length === 2
  if (provider.name === 'pages' && apex) {
    throw siteError(
      422,
      'site_domain_apex',
      `Root domains can't be connected directly. Connect www.${hostname} and forward ${hostname} to it at your DNS provider`
    )
  }
  const dnsProvider = found ? detectDnsProvider(found.nameservers).key : null

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
  let reg
  try {
    reg = await provider.register({ hostname, verifyToken, providerRef: null })
  } catch (err) {
    if (isCapacityError(err)) {
      await alertCapacity(clinicId, hostname, (err as Error).message)
      throw siteError(
        503,
        'site_domain_capacity',
        "We can't add more custom domains right now. Our team has been told and will sort it out"
      )
    }
    if (err instanceof PagesError) {
      throw siteError(
        502,
        'site_domain_provider',
        `Cloudflare could not add the domain: ${err.message}`
      )
    }
    throw err
  }
  const row = await prisma.siteDomain.create({
    data: {
      clinicId,
      hostname,
      kind: 'CUSTOM',
      status: 'PENDING',
      stage: 'dns',
      verifyToken,
      providerRef: reg.providerRef,
      sslStatus: reg.sslStatus,
      zone,
      dnsProvider,
    },
  })
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_DOMAIN_ADDED',
    newValue: { hostname, provider: provider.name, dnsProvider },
  })
  return publicDomain(row, reg.records)
}

async function alertCapacity(clinicId: string, hostname: string, reason: string) {
  try {
    await logAudit({
      clinicId,
      performedById: null,
      entityType: 'SiteDomain',
      entityId: hostname,
      action: 'SITE_DOMAIN_CAPACITY',
      newValue: { hostname },
      severity: 'warning',
    })
    const clinic = await prisma.clinic.findFirst({
      where: { id: clinicId },
      select: { name: true },
    })
    for (const to of await platformAlertRecipients()) {
      await sendDomainCapacityEmail({ to, clinicName: clinic?.name ?? clinicId, hostname, reason })
    }
  } catch (err) {
    console.warn('[site-domains] capacity alert not sent:', (err as Error).message)
  }
  console.error(`[site-domains] Pages refused ${hostname}: ${reason}`)
}

async function findCustom(clinicId: string, id: string) {
  const row = await prisma.siteDomain.findFirst({ where: { id, clinicId } })
  if (!row) throw notFound('Domain')
  return row
}

// ─── Checking a domain (CTO-38) ─────────────────────────────────────────────

/** A poll within this window returns the stored state instead of re-checking. */
export const POLL_THROTTLE_MS = 15_000

export type RefreshSource = 'poll' | 'manual' | 'cron'

/**
 * Checks one custom domain and moves it along dns → verified → ssl → live.
 *
 *  - `manual` (the Verify button) always checks and audits the result.
 *  - `poll` (the screen, every few seconds) is throttled to one real check
 *    per 15 s per domain.
 *  - `cron` (every 5 minutes) catches up on domains nobody is watching.
 *
 * Background checks never take a verified domain offline: a DNS answer that
 * looks wrong is recorded and shown to the owner, but only a person pressing
 * Verify can turn a verified domain back to unverified. Stage changes are
 * audited, so a poll every 10 s writes no audit noise.
 */
async function refreshRow(
  row: DomainRow,
  source: RefreshSource,
  actor: SiteActor | null
): Promise<{ row: DomainRow; records?: DnsRecord[] }> {
  if (row.kind !== 'CUSTOM') return { row }
  if (
    source === 'poll' &&
    row.lastCheckedAt &&
    Date.now() - row.lastCheckedAt.getTime() < POLL_THROTTLE_MS
  ) {
    return { row }
  }
  const provider = getDomainProvider()
  let check: DomainCheck
  try {
    check = await provider.check({
      hostname: row.hostname,
      verifyToken: row.verifyToken ?? '',
      providerRef: row.providerRef,
      lastRetryAt: row.lastRetryAt,
    })
  } catch (err) {
    console.warn(`[site-domains] check failed for ${row.hostname}:`, (err as Error).message)
    check = {
      status: row.status === 'VERIFIED' ? 'VERIFIED' : 'PENDING',
      sslStatus: row.sslStatus,
      records: [],
      error: `We couldn't reach ${provider.name === 'manual' ? 'DNS' : 'Cloudflare'} just now. We'll try again shortly`,
    }
  }

  // Background checks don't downgrade a verified domain (see above).
  const drift = source !== 'manual' && row.status === 'VERIFIED' && check.status !== 'VERIFIED'
  const status = drift ? 'VERIFIED' : check.status

  let stage: DomainStage
  let probeDetail: string | null = null
  if (drift) {
    stage = row.stage as DomainStage
  } else if (status !== 'VERIFIED') {
    stage = 'dns'
  } else if (check.sslStatus === 'blocked' || check.sslStatus === 'error') {
    stage = 'error'
  } else if (check.sslStatus === 'active' || provider.name === 'manual') {
    const probe = await httpsProbe()(row.hostname)
    stage = probe.ok ? 'live' : check.sslStatus === 'active' ? 'ssl' : 'verified'
    if (!probe.ok) probeDetail = probe.detail
  } else {
    stage = 'verified'
  }

  const lastError = drift
    ? `DNS for ${row.hostname} no longer looks right: ${check.error ?? 'records changed'}`
    : stage === 'live'
      ? null
      : (check.error ?? probeDetail)
  const becameVerified = status === 'VERIFIED' && row.status !== 'VERIFIED'
  const updated = await prisma.siteDomain.update({
    where: { id: row.id, clinicId: row.clinicId },
    data: {
      status,
      stage,
      sslStatus: check.sslStatus,
      lastError,
      lastCheckedAt: new Date(),
      ...(check.checks ? { checks: check.checks as unknown as Prisma.InputJsonValue } : {}),
      ...(becameVerified ? { verifiedAt: new Date() } : {}),
      ...(stage === 'live' && row.stage !== 'live' ? { liveAt: new Date() } : {}),
      ...(check.retried ? { lastRetryAt: new Date() } : {}),
    },
  })
  if (status !== row.status || source === 'manual') invalidateHostCache()

  if (source === 'manual' && actor) {
    await auditSite(actor, {
      entityType: 'SiteDomain',
      entityId: row.id,
      action: check.status === 'VERIFIED' ? 'SITE_DOMAIN_VERIFIED' : 'SITE_DOMAIN_CHECK_FAILED',
      newValue: { hostname: row.hostname, status: check.status },
    })
  }
  if (stage !== row.stage) {
    await auditDomain(actor, row.clinicId, {
      entityType: 'SiteDomain',
      entityId: row.id,
      action: 'SITE_DOMAIN_STAGE',
      oldValue: row.stage,
      newValue: { hostname: row.hostname, stage, source },
      severity: stage === 'error' ? 'warning' : 'info',
    })
    if (stage === 'live') {
      await auditDomain(actor, row.clinicId, {
        entityType: 'SiteDomain',
        entityId: row.id,
        action: 'SITE_DOMAIN_LIVE',
        newValue: { hostname: row.hostname },
      })
    }
  }
  if (drift && !row.lastError) {
    await auditDomain(actor, row.clinicId, {
      entityType: 'SiteDomain',
      entityId: row.id,
      action: 'SITE_DOMAIN_DRIFT',
      newValue: { hostname: row.hostname },
      severity: 'warning',
    })
  }
  return { row: updated, records: check.records.length ? check.records : undefined }
}

export async function verifyDomain(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.kind !== 'CUSTOM') return publicDomain(row)
  const out = await refreshRow(row, 'manual', actor)
  return publicDomain(out.row, out.records)
}

/** The Domains screen polls this while a domain is connecting (throttled). */
export async function domainStatus(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  const out = await refreshRow(row, 'poll', actor)
  return publicDomain(out.row, out.records)
}

/**
 * Background re-check (cron, every 5 min; inside a tenant bypass). Domains
 * still connecting (last 14 days) by default; `live` re-checks live domains
 * for DNS drift (daily). Returns how many changed stage.
 */
export async function recheckDomains(opts: { live?: boolean; take?: number } = {}) {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000)
  const rows = await prisma.siteDomain.findMany({
    where: opts.live
      ? { kind: 'CUSTOM', stage: 'live' }
      : { kind: 'CUSTOM', stage: { not: 'live' }, createdAt: { gte: since } },
    orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: opts.take ?? 50,
  })
  let changed = 0
  for (const row of rows) {
    try {
      const out = await refreshRow(row, 'cron', null)
      if (out.row.stage !== row.stage) changed++
    } catch (err) {
      console.warn(`[site-domains] re-check of ${row.hostname} failed:`, (err as Error).message)
    }
  }
  return changed
}

// ─── Domain Connect (CTO-38 AC3) ────────────────────────────────────────────

/**
 * Can this domain be connected in one click, and where does the button go?
 * Only for a sub-domain (the template needs a host) of a zone whose DNS
 * provider has onboarded MedoFlow's template.
 */
export async function domainConnectInfo(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.kind !== 'CUSTOM' || row.stage === 'live') {
    return { available: false as const, reason: 'not_needed' }
  }
  const cfg = domainConnectConfig()
  if (!cfg) return { available: false as const, reason: 'not_configured' }
  const zone =
    row.zone ??
    (
      await withTimeout(
        findZone(row.hostname).catch(() => null),
        5_000
      )
    )?.zone
  const host = zone ? relativeHost(row.hostname, zone) : undefined
  if (!zone || !host || host === '@') return { available: false as const, reason: 'not_supported' }
  const found = await discover(zone)
  if (!found.available) return { available: false as const, reason: found.reason }
  const url = buildApplyUrl({
    provider: found.provider,
    config: cfg,
    zone,
    host,
    target: siteCnameTarget(),
    token: row.verifyToken ?? '',
    redirectUri: `${frontendOrigin()}/dashboard/site/domains?dc=${encodeURIComponent(row.id)}`,
    state: connectState(row.id),
  })
  return { available: true as const, providerName: found.provider.providerName, url }
}

/** The DNS provider sent the owner back: check `state`, then check DNS right away. */
export async function domainConnectReturn(
  actor: SiteActor,
  id: string,
  input: { state?: string; error?: string }
) {
  const row = await findCustom(actor.clinicId, id)
  if (!verifyConnectState(row.id, input.state)) {
    throw siteError(400, 'site_connect_state', 'This link has expired. Start the connection again')
  }
  await auditSite(actor, {
    entityType: 'SiteDomain',
    entityId: row.id,
    action: 'SITE_DOMAIN_CONNECT_RETURN',
    newValue: { hostname: row.hostname, error: input.error ? input.error.slice(0, 40) : null },
  })
  const out = await refreshRow(row, 'manual', actor)
  return { ...publicDomain(out.row, out.records), connectError: input.error ?? null }
}

export async function setPrimaryDomain(actor: SiteActor, id: string) {
  const row = await findCustom(actor.clinicId, id)
  if (row.status !== 'VERIFIED') {
    throw siteError(409, 'site_domain_unverified', 'Verify the domain before making it primary')
  }
  // CTO-38: every other address will 301 here, so HTTPS must already work.
  if (row.kind === 'CUSTOM' && row.stage !== 'live' && getDomainProvider().name !== 'manual') {
    throw siteError(
      409,
      'site_domain_not_live',
      `Wait until ${row.hostname} is live (HTTPS working) before making it primary`
    )
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
    // Best effort: a provider hiccup must not stop the owner removing a domain.
    await getDomainProvider()
      .remove({
        hostname: row.hostname,
        verifyToken: row.verifyToken ?? '',
        providerRef: row.providerRef,
      })
      .catch((err: unknown) =>
        console.warn(
          `[site-domains] provider remove failed for ${row.hostname}:`,
          (err as Error).message
        )
      )
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

/** Off-boarding: remove every custom domain from the provider. Best effort, never throws. */
export async function removeProviderDomains(clinicIds: string[]): Promise<number> {
  if (!clinicIds.length) return 0
  let removed = 0
  try {
    const rows = await prisma.siteDomain.findMany({
      where: { clinicId: { in: clinicIds }, kind: 'CUSTOM' },
      select: { hostname: true, verifyToken: true, providerRef: true },
    })
    const provider = getDomainProvider()
    for (const r of rows) {
      try {
        await provider.remove({
          hostname: r.hostname,
          verifyToken: r.verifyToken ?? '',
          providerRef: r.providerRef,
        })
        removed++
      } catch (err) {
        console.warn(
          `[site-domains] off-boarding: ${r.hostname} not removed:`,
          (err as Error).message
        )
      }
    }
  } catch (err) {
    console.warn('[site-domains] off-boarding domain removal skipped:', (err as Error).message)
  }
  return removed
}

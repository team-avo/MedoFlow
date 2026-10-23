/**
 * Host → clinic site resolution (B8.2). Called for every public site request
 * and every CORS preflight from a clinic domain, so results are cached in
 * process for a minute (bounded, cleared on any domain change).
 */
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import { classifyHost, normalizeHost, siteOrigin, subdomainHost } from '../routing/hosts'
import { subdomainsEnabled } from '../config'

export type ResolvedHost =
  | { kind: 'site'; clinicId: string; clinicSlug: string | null; host: string; origin: string }
  /** A real site host that isn't the primary: 301 to `origin`. */
  | { kind: 'alias'; clinicId: string; host: string; origin: string }
  | { kind: 'app' }
  | { kind: 'api' }
  | { kind: 'unknown' }

const TTL_MS = 60_000
const MAX_ENTRIES = 5000
const cache = new Map<string, { value: ResolvedHost; expires: number }>()

export function invalidateHostCache(): void {
  cache.clear()
}

async function lookup(host: string): Promise<ResolvedHost> {
  const mode = classifyHost(host)
  if (mode.mode === 'app') return { kind: 'app' }
  if (mode.mode === 'api') return { kind: 'api' }
  if (mode.mode === 'invalid') return { kind: 'unknown' }
  if (mode.mode === 'site-subdomain' && !subdomainsEnabled()) return { kind: 'unknown' }

  const row = await prisma.siteDomain.findUnique({
    where: { hostname: mode.mode === 'site-subdomain' ? mode.label : mode.hostname },
    select: {
      clinicId: true,
      kind: true,
      status: true,
      isPrimary: true,
      clinic: { select: { isActive: true, slug: true } },
    },
  })
  const kindMatches =
    row && (mode.mode === 'site-subdomain' ? row.kind === 'SUBDOMAIN' : row.kind === 'CUSTOM')
  if (!row || !kindMatches || row.status !== 'VERIFIED' || !row.clinic.isActive) {
    return { kind: 'unknown' }
  }
  if (row.isPrimary) {
    return {
      kind: 'site',
      clinicId: row.clinicId,
      clinicSlug: row.clinic.slug,
      host,
      origin: siteOrigin(host),
    }
  }
  const primary = await prisma.siteDomain.findFirst({
    where: {
      clinicId: row.clinicId,
      isPrimary: true,
      status: 'VERIFIED',
      ...(subdomainsEnabled() ? {} : { kind: 'CUSTOM' as const }),
    },
    select: { kind: true, hostname: true },
  })
  if (!primary) {
    // No primary set: this host serves the site itself.
    return {
      kind: 'site',
      clinicId: row.clinicId,
      clinicSlug: row.clinic.slug,
      host,
      origin: siteOrigin(host),
    }
  }
  const primaryHost =
    primary.kind === 'SUBDOMAIN' ? subdomainHost(primary.hostname) : primary.hostname
  return { kind: 'alias', clinicId: row.clinicId, host, origin: siteOrigin(primaryHost) }
}

/** Resolves a Host header. Runs in a tenant bypass: hosts are public by nature. */
export async function resolveHost(raw: string | undefined | null): Promise<ResolvedHost> {
  const host = normalizeHost(raw)
  if (!host) return { kind: 'unknown' }
  const now = Date.now()
  const hit = cache.get(host)
  if (hit && hit.expires > now) return hit.value
  const value = await withTenantBypass('site.resolve_host', () => lookup(host))
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  cache.set(host, { value, expires: now + TTL_MS })
  return value
}

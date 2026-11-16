/**
 * DNS diagnostics for clinic custom domains (CTO-38): which zone a hostname
 * lives in, who runs its DNS, and what exactly is wrong with each record the
 * clinic must create. Every provider uses these checks, so the owner sees
 * the same plain-language messages whichever one is configured.
 *
 * Lookups go through a short-timeout resolver (2.5 s, 2 tries) and every
 * failure is swallowed into "not found": DNS answers are hints, never
 * exceptions.
 */
import { promises as dnsPromises } from 'dns'
import { BlockList, isIP } from 'net'
import { siteCnameTarget } from '../config'
import type { DnsRecord, RecordCheck } from './types'

/** The subset of dns.promises the checks use; injectable for tests. */
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>
  resolveCname(name: string): Promise<string[]>
  resolve4(name: string): Promise<string[]>
  resolveNs?(name: string): Promise<string[]>
  resolveCaa?(
    name: string
  ): Promise<Array<{ critical: number; issue?: string; issuewild?: string }>>
}

let defaultResolver: DnsResolver | null = null
let override: DnsResolver | null = null

/** The resolver for live checks (or the test stub). */
export function dnsResolver(): DnsResolver {
  if (override) return override
  return (defaultResolver ??= new dnsPromises.Resolver({ timeout: 2500, tries: 2 }))
}

/** Tests: route every DNS lookup to a stub (null restores real DNS). */
export function setDnsResolverForTests(r: DnsResolver | null): void {
  override = r
}

export const VERIFY_PREFIX = '_medoflow-verify'

const norm = (h: string) => h.toLowerCase().replace(/\.$/, '')

const swallow = async <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => {
  if (!p) return fallback
  try {
    return await p
  } catch {
    return fallback
  }
}

/** `name` relative to `zone`: `www`, `_medoflow-verify.www`, or `@`. */
export function relativeHost(name: string, zone: string | null | undefined): string | undefined {
  if (!zone) return undefined
  const n = norm(name)
  const z = norm(zone)
  if (n === z) return '@'
  return n.endsWith(`.${z}`) ? n.slice(0, -(z.length + 1)) : undefined
}

export function ownershipRecord(hostname: string, token: string, zone?: string | null): DnsRecord {
  const name = `${VERIFY_PREFIX}.${hostname}`
  return {
    type: 'TXT',
    name,
    value: `medoflow-verify=${token}`,
    purpose: 'ownership',
    ...(relativeHost(name, zone) ? { host: relativeHost(name, zone) } : {}),
  }
}

export function routingRecord(hostname: string, zone?: string | null): DnsRecord {
  return {
    type: 'CNAME',
    name: hostname,
    value: siteCnameTarget(),
    purpose: 'routing',
    ...(relativeHost(hostname, zone) ? { host: relativeHost(hostname, zone) } : {}),
  }
}

// ─── Zone and DNS provider ──────────────────────────────────────────────────

/**
 * The DNS zone a hostname belongs to: the most specific name, walking up,
 * that has its own NS records. Works for `www.clinic.co.uk` without a public
 * suffix list. Levels that are CNAMEs are skipped (an NS query on an alias
 * can return the target's servers). Stops before the TLD.
 */
export async function findZone(
  hostname: string,
  dns: DnsResolver = dnsResolver()
): Promise<{ zone: string; nameservers: string[] } | null> {
  if (!dns.resolveNs) return null
  const labels = norm(hostname).split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join('.')
    if (i === 0 && labels.length > 2) {
      const alias = await swallow(dns.resolveCname(name), [] as string[])
      if (alias.length) continue
    }
    const ns = (await swallow(dns.resolveNs(name), [] as string[])).map(norm)
    if (ns.length) return { zone: name, nameservers: ns.sort() }
  }
  return null
}

export type DnsProviderKey =
  | 'godaddy'
  | 'namecheap'
  | 'cloudflare'
  | 'squarespace'
  | 'route53'
  | 'ionos'
  | 'wix'
  | 'other'

/** Nameserver suffix → who runs the clinic's DNS. Order matters (first match). */
const NS_PROVIDERS: Array<{ key: DnsProviderKey; name: string; match: RegExp }> = [
  { key: 'godaddy', name: 'GoDaddy', match: /\.domaincontrol\.com$/ },
  {
    key: 'namecheap',
    name: 'Namecheap',
    match: /\.registrar-servers\.com$|\.namecheaphosting\.com$/,
  },
  { key: 'cloudflare', name: 'Cloudflare', match: /\.ns\.cloudflare\.com$/ },
  // Google Domains moved to Squarespace; both name-server sets are Squarespace's now.
  {
    key: 'squarespace',
    name: 'Squarespace (formerly Google Domains)',
    match: /\.googledomains\.com$|\.squarespacedns\.com$/,
  },
  { key: 'route53', name: 'Amazon Route 53', match: /\.awsdns-\d+\.(com|net|org|co\.uk)$/ },
  { key: 'ionos', name: 'IONOS', match: /\.ui-dns\.(com|de|org|biz)$/ },
  { key: 'wix', name: 'Wix', match: /\.wixdns\.net$/ },
]

/** Display name for a stored provider key. */
export function dnsProviderLabel(key: string | null | undefined): string | null {
  if (!key) return null
  return NS_PROVIDERS.find((p) => p.key === key)?.name ?? 'your DNS provider'
}

export function detectDnsProvider(nameservers: string[]): { key: DnsProviderKey; name: string } {
  for (const p of NS_PROVIDERS) {
    if (nameservers.some((ns) => p.match.test(norm(ns)))) return { key: p.key, name: p.name }
  }
  return { key: 'other', name: 'your DNS provider' }
}

// ─── Record checks ──────────────────────────────────────────────────────────

/** Cloudflare's published edge ranges (IPv4): a proxied ("orange cloud") record resolves here. */
const CLOUDFLARE_V4 = new BlockList()
for (const [net, bits] of [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
] as const) {
  CLOUDFLARE_V4.addSubnet(net, bits, 'ipv4')
}
export const isCloudflareIp = (ip: string) => isIP(ip) === 4 && CLOUDFLARE_V4.check(ip, 'ipv4')

/** Certificate authorities Cloudflare uses for Pages / SaaS certificates. */
const ALLOWED_CAS = ['letsencrypt.org', 'pki.goog', 'digicert.com', 'sectigo.com', 'ssl.com']

export interface RecordsResult {
  /** TXT and CNAME are both right: the clinic owns the name and it points at us. */
  ok: boolean
  checks: RecordCheck[]
  /** The first problem, for the one-line status. */
  error: string | null
}

/**
 * Checks the ownership TXT, the routing CNAME (or a flattened apex with the
 * same addresses), and whether CAA records would block the certificate.
 */
export async function checkRecords(
  input: { hostname: string; token: string; target?: string },
  dns: DnsResolver = dnsResolver()
): Promise<RecordsResult> {
  const host = norm(input.hostname)
  const target = norm(input.target ?? siteCnameTarget())
  const own = ownershipRecord(host, input.token)

  // 1. Ownership TXT.
  const txt = (await swallow(dns.resolveTxt(own.name), [] as string[][])).map((c) => c.join(''))
  const txtOk = txt.includes(own.value)
  const ownership: RecordCheck = {
    type: 'TXT',
    name: own.name,
    purpose: 'ownership',
    ok: txtOk,
    found: txt,
    message: txtOk
      ? null
      : txt.length
        ? `TXT record ${own.name} has "${txt[0]}", expected "${own.value}"`
        : `TXT record ${own.name} not found yet (DNS changes can take up to an hour)`,
  }

  // 2. Routing CNAME (or a flattened apex: ALIAS / ANAME / CNAME flattening).
  const cnames = (await swallow(dns.resolveCname(host), [] as string[])).map(norm)
  let routing: RecordCheck
  if (cnames.includes(target)) {
    routing = {
      type: 'CNAME',
      name: host,
      purpose: 'routing',
      ok: true,
      found: cnames,
      message: null,
    }
  } else if (cnames.length) {
    routing = {
      type: 'CNAME',
      name: host,
      purpose: 'routing',
      ok: false,
      found: cnames,
      message: `CNAME ${host} points to ${cnames[0]}, expected ${target}`,
    }
  } else {
    const [mine, theirs] = await Promise.all([
      swallow(dns.resolve4(host), [] as string[]),
      swallow(dns.resolve4(target), [] as string[]),
    ])
    const flattened = mine.length > 0 && mine.every((ip) => theirs.includes(ip))
    let message: string | null = null
    if (!flattened) {
      if (mine.length && mine.every(isCloudflareIp)) {
        message = `${host} is proxied by Cloudflare (orange cloud). Set its proxy status to "DNS only" and point the CNAME to ${target}`
      } else if (mine.length) {
        message = `${host} has an A record (${mine.slice(0, 3).join(', ')}) instead of a CNAME to ${target}. Delete the A record, then add the CNAME`
      } else {
        message = `No CNAME record for ${host} yet. Add a CNAME pointing to ${target}`
      }
    }
    routing = {
      type: 'CNAME',
      name: host,
      purpose: 'routing',
      ok: flattened,
      found: mine,
      message,
    }
  }

  const checks: RecordCheck[] = [routing, ownership]

  // 3. CAA: the closest name (walking up) with CAA records decides who may issue.
  if (dns.resolveCaa) {
    const labels = host.split('.')
    for (let i = 0; i < labels.length - 1; i++) {
      const name = labels.slice(i).join('.')
      const caa = await swallow(dns.resolveCaa(name), [])
      const issuers = caa
        .map((r) => r.issue)
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.split(';')[0]!.trim().toLowerCase())
      if (!caa.length) continue
      if (issuers.length) {
        const ok = issuers.some((v) => ALLOWED_CAS.includes(v))
        checks.push({
          type: 'CAA',
          name,
          purpose: 'certificate',
          ok,
          found: issuers,
          message: ok
            ? null
            : `CAA records on ${name} only allow ${issuers.join(', ')}. Add a CAA record allowing letsencrypt.org and pki.goog, or the HTTPS certificate can't be issued`,
        })
      }
      break
    }
  }

  const problem = checks.find((c) => !c.ok)
  return {
    ok: routing.ok && ownership.ok,
    checks,
    error: (!ownership.ok ? ownership.message : null) ?? problem?.message ?? null,
  }
}

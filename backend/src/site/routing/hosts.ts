/**
 * Host classification (B8.2) — pure functions, mirrored by
 * frontend/lib/site/host.ts and held to shared/validation-cases/site-routes.json.
 *
 *   app             the dashboard app (APP_HOSTS)
 *   api             the API host (api.<root>)
 *   site-subdomain  <label>.<root>          → SiteDomain(kind SUBDOMAIN, hostname = label)
 *   site-custom     any other valid host     → SiteDomain(kind CUSTOM, hostname = host)
 *   invalid         not a hostname at all
 */
import { domainToASCII } from 'url'
import { appHostPatterns, RESERVED_SITE_LABELS, siteRootDomain } from '../config'

export type HostMode =
  | { mode: 'app' }
  | { mode: 'api' }
  | { mode: 'site-subdomain'; label: string }
  | { mode: 'site-custom'; hostname: string }
  | { mode: 'invalid' }

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Lowercase ASCII host without port or trailing dot; null when not a hostname. */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null
  let h = raw.trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  h = h.split('/')[0]!.split('?')[0]!
  if (h.startsWith('[')) return null // IPv6 literal — never a site
  h = h.replace(/:\d{1,5}$/, '').replace(/\.$/, '')
  const ascii = domainToASCII(h)
  if (!ascii || ascii.length > 253) return null
  const labels = ascii.split('.')
  if (!labels.every((l) => LABEL_RE.test(l))) return null
  return ascii
}

export const isIpv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)

export function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // ".workers.dev"
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === pattern
}

export function classifyHost(raw: string, env: NodeJS.ProcessEnv = process.env): HostMode {
  const host = normalizeHost(raw)
  if (!host) return { mode: 'invalid' }
  if (appHostPatterns(env).some((p) => matchesHostPattern(host, p))) return { mode: 'app' }
  const root = siteRootDomain(env)
  if (host === `api.${root}`) return { mode: 'api' }
  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1))
    if (label.includes('.') || RESERVED_SITE_LABELS.has(label)) return { mode: 'invalid' }
    return { mode: 'site-subdomain', label }
  }
  if (isIpv4(host) || host === root || !host.includes('.')) return { mode: 'invalid' }
  return { mode: 'site-custom', hostname: host }
}

/** Scheme + port for site URLs: http://<label>.localhost:3000 in dev, https otherwise. */
export function siteOrigin(host: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = siteRootDomain(env)
  const local = root === 'localhost' || host === 'localhost' || host.endsWith('.localhost')
  const scheme = env.SITE_PUBLIC_SCHEME || (local ? 'http' : 'https')
  const port = env.SITE_PUBLIC_PORT ? `:${env.SITE_PUBLIC_PORT}` : local ? ':3000' : ''
  return `${scheme}://${host}${port}`
}

export function subdomainHost(label: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${label}.${siteRootDomain(env)}`
}

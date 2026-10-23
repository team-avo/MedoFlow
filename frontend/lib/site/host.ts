/**
 * Host classification for the edge middleware — frontend mirror of
 * backend/src/site/routing/hosts.ts (same cases: shared/validation-cases/site-routes.json).
 *
 *   NEXT_PUBLIC_SITE_ROOT_DOMAIN  clinic subdomains live under it (e.g. medoflow.com)
 *   NEXT_PUBLIC_APP_HOSTS         hosts serving the dashboard app; "*.workers.dev" allowed
 */

export type HostMode =
  | { mode: 'app' }
  | { mode: 'api' }
  | { mode: 'site-subdomain'; label: string }
  | { mode: 'site-custom'; hostname: string }
  | { mode: 'invalid' }

export interface HostEnv {
  SITE_ROOT_DOMAIN?: string
  APP_HOSTS?: string
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

const RESERVED_SITE_LABELS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'pop',
  'imap',
  'ns1',
  'ns2',
  'ftp',
  'cdn',
  'media',
  'assets',
  'static',
  'status',
  'help',
  'support',
  'blog',
  'docs',
  'dev',
  'staging',
  'medoflow',
  'sites',
  'preview',
])

export function hostEnvFromProcess(): HostEnv {
  return {
    SITE_ROOT_DOMAIN: process.env.NEXT_PUBLIC_SITE_ROOT_DOMAIN,
    APP_HOSTS: process.env.NEXT_PUBLIC_APP_HOSTS,
  }
}

export function siteRootDomain(env: HostEnv): string {
  return (env.SITE_ROOT_DOMAIN || 'localhost')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
}

export function appHostPatterns(env: HostEnv): string[] {
  const root = siteRootDomain(env)
  const list = (env.APP_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? list : [root, `app.${root}`, '127.0.0.1', '*.workers.dev']
}

/** Lowercase host without port or trailing dot; null when not a hostname. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  let h = raw.trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  h = h.split('/')[0]!.split('?')[0]!
  if (h.startsWith('[')) return null
  h = h.replace(/:\d{1,5}$/, '').replace(/\.$/, '')
  if (!h || h.length > 253) return null
  // Hostnames reaching the middleware are already ASCII (browsers send punycode).
  if (!h.split('.').every((l) => LABEL_RE.test(l))) return null
  return h
}

export function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  }
  return host === pattern
}

const isIpv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)

export function classifyHost(
  raw: string | null | undefined,
  env: HostEnv = hostEnvFromProcess()
): HostMode {
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

/** True in the browser when the page is served on a clinic's own host. */
export function isOnClinicSiteHost(): boolean {
  if (typeof window === 'undefined') return false
  const m = classifyHost(window.location.host).mode
  return m === 'site-subdomain' || m === 'site-custom'
}

/**
 * Clinic-site configuration (B8.2). Read per call so tests can change the
 * environment; every value has a safe development default.
 *
 *   SITE_ROOT_DOMAIN    clinic subdomains live under it: <label>.<root>
 *                       (e.g. medoflow.com; "localhost" in local dev)
 *   APP_HOSTS           hosts that serve the dashboard app, comma-separated;
 *                       "*.workers.dev" style suffix patterns allowed
 *   SITE_CNAME_TARGET   what a clinic's custom domain must CNAME to
 *   DOMAIN_PROVIDER     manual (DNS TXT check) | cloudflare (Cloudflare for SaaS)
 *   SITE_PREVIEW_SECRET HMAC key for draft-preview links
 */
import crypto from 'crypto'

export function siteRootDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SITE_ROOT_DOMAIN || 'localhost')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
}

export function appHostPatterns(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = siteRootDomain(env)
  const list = (env.APP_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? list : [root, `app.${root}`, '127.0.0.1', '*.workers.dev']
}

/** Labels under the root domain that never belong to a clinic. */
export const RESERVED_SITE_LABELS: ReadonlySet<string> = new Set([
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

export function siteCnameTarget(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SITE_CNAME_TARGET || `sites.${siteRootDomain(env)}`).trim().toLowerCase()
}

export type DomainProviderName = 'manual' | 'cloudflare'

export function domainProviderName(env: NodeJS.ProcessEnv = process.env): DomainProviderName {
  const v = (env.DOMAIN_PROVIDER || 'manual').trim()
  if (v !== 'manual' && v !== 'cloudflare') {
    throw new Error(`DOMAIN_PROVIDER must be "manual" or "cloudflare" (got "${v}")`)
  }
  return v
}

let devPreviewKey: Buffer | null = null

/** Preview-link key. Production requires SITE_PREVIEW_SECRET (envValidation). */
export function previewSecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  if (env.SITE_PREVIEW_SECRET) return Buffer.from(env.SITE_PREVIEW_SECRET, 'utf8')
  if (env.JWT_SECRET) {
    return crypto.createHash('sha256').update(`site-preview:${env.JWT_SECRET}`).digest()
  }
  return (devPreviewKey ??= crypto.randomBytes(32))
}

/** Public base URL of uploaded site images (an R2 public bucket or CDN). */
export function siteAssetsPublicBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.SITE_ASSETS_PUBLIC_BASE_URL?.trim()
  return v ? v.replace(/\/+$/, '') : null
}

export function siteAssetsBucket(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.SITE_ASSETS_BUCKET?.trim() || null
}

/** This API's own public origin (for local-driver asset URLs). */
export function apiPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BACKEND_URL || `http://localhost:${env.PORT || 3001}`).replace(/\/+$/, '')
}

/**
 * Clinic subdomains are live only once SITE_ROOT_DOMAIN is configured (and
 * its wildcard DNS points at the frontend). Until then sites are served at
 * the path fallback <app>/s/<slug>.
 */
export function subdomainsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SITE_ROOT_DOMAIN?.trim())
}

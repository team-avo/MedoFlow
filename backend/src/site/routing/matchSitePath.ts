import {
  MAX_SITE_PATH_SEGMENTS,
  RESERVED_SITE_SEGMENTS,
  SITE_SLUG_RE,
  type SiteRouteKey,
} from './routeKeys'

export type SiteRouteParams = Partial<Record<'slug' | 'pageId', string>>

export type SitePathMatch =
  | { type: 'route'; key: SiteRouteKey; params: SiteRouteParams; path: string }
  /** The request path is not in canonical form; 301 to `to`. */
  | { type: 'redirect'; to: string }
  | { type: 'none'; path: string }

const PAGE_ID_RE = /^[a-z0-9]{8,40}$/

/** Lowercase, single slashes, no trailing slash. Returns null when undecodable. */
export function normalizeSitePath(raw: string): string | null {
  let path = raw.split('?')[0]!.split('#')[0]!
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  path = `/${path}`.replace(/\/{2,}/g, '/').toLowerCase()
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/'
  return path
}

const SINGLE: Partial<Record<string, SiteRouteKey>> = {
  services: 'services',
  team: 'team',
  store: 'store',
  book: 'book',
  contact: 'contact',
  'sitemap.xml': 'sitemap',
  'robots.txt': 'robots',
  'favicon.ico': 'favicon',
}

const NESTED: Partial<Record<string, SiteRouteKey>> = {
  services: 'service',
  team: 'provider',
  store: 'product',
  book: 'book',
  legal: 'legal',
}

/** Classifies a clinic-site request path against the route table. */
export function matchSitePath(raw: string): SitePathMatch {
  const path = normalizeSitePath(raw)
  if (path === null) return { type: 'none', path: raw }
  const original = raw.split('?')[0]!.split('#')[0]!
  if (path !== original && safeDecode(original) !== path) return { type: 'redirect', to: path }

  const segs = path.split('/').filter(Boolean)
  if (segs.length > MAX_SITE_PATH_SEGMENTS) return { type: 'none', path }
  if (segs.length === 0) return { type: 'route', key: 'home', params: {}, path }

  const [first, second, third] = segs as [string, string | undefined, string | undefined]
  if (third !== undefined) return { type: 'none', path }

  if (second === undefined) {
    const key = SINGLE[first]
    if (key) return { type: 'route', key, params: {}, path }
    if (RESERVED_SITE_SEGMENTS.has(first) || !SITE_SLUG_RE.test(first)) {
      return { type: 'none', path }
    }
    return { type: 'route', key: 'page', params: { slug: first }, path }
  }

  if (first === 'preview') {
    return PAGE_ID_RE.test(second)
      ? { type: 'route', key: 'preview', params: { pageId: second }, path }
      : { type: 'none', path }
  }
  const key = NESTED[first]
  if (key && SITE_SLUG_RE.test(second)) {
    return { type: 'route', key, params: { slug: second }, path }
  }
  return { type: 'none', path }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

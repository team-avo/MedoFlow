/**
 * Clinic-site route registry — frontend mirror of backend/src/site/routing/*.
 * Both are held to shared/validation-cases/site-routes.json, so a route can't
 * exist on one side only. Every clinic-site URL in the frontend is built
 * with buildSitePath + withSiteBase; nothing joins URL strings by hand.
 */
import type { SiteRouteKey } from './types'

export const SITE_ROUTE_KEYS: readonly SiteRouteKey[] = [
  'home',
  'page',
  'services',
  'service',
  'team',
  'provider',
  'store',
  'product',
  'book',
  'contact',
  'legal',
  'preview',
  'sitemap',
  'robots',
  'favicon',
]

export const RESERVED_SITE_SEGMENTS: ReadonlySet<string> = new Set([
  'services',
  'team',
  'store',
  'book',
  'contact',
  'legal',
  'preview',
  's',
  'api',
  '_next',
  '_site',
  'login',
  'register',
  'dashboard',
  'account',
  'checkout',
  'payment',
  'platform',
  'onboarding',
  'consultation',
  'intake',
  'home',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
])

export const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/
const PAGE_ID_RE = /^[a-z0-9]{8,40}$/
export const MAX_SITE_PATH_SEGMENTS = 3

export type SiteRouteParams = Partial<Record<'slug' | 'pageId', string>>

export type SitePathMatch =
  | { type: 'route'; key: SiteRouteKey; params: SiteRouteParams; path: string }
  | { type: 'redirect'; to: string }
  | { type: 'none'; path: string }

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

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

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
    if (RESERVED_SITE_SEGMENTS.has(first) || !SITE_SLUG_RE.test(first))
      return { type: 'none', path }
    return { type: 'route', key: 'page', params: { slug: first }, path }
  }
  if (first === 'preview') {
    return PAGE_ID_RE.test(second)
      ? { type: 'route', key: 'preview', params: { pageId: second }, path }
      : { type: 'none', path }
  }
  const key = NESTED[first]
  if (key && SITE_SLUG_RE.test(second))
    return { type: 'route', key, params: { slug: second }, path }
  return { type: 'none', path }
}

const slugOrThrow = (key: SiteRouteKey, slug: string | undefined): string => {
  if (!slug || !SITE_SLUG_RE.test(slug)) throw new Error(`Route "${key}" needs a valid slug`)
  return slug
}

export function buildSitePath(key: SiteRouteKey, params: SiteRouteParams = {}): string {
  switch (key) {
    case 'home':
      return '/'
    case 'page': {
      const slug = slugOrThrow(key, params.slug)
      if (RESERVED_SITE_SEGMENTS.has(slug)) throw new Error(`"${slug}" is a reserved path`)
      return `/${slug}`
    }
    case 'services':
      return '/services'
    case 'service':
      return `/services/${slugOrThrow(key, params.slug)}`
    case 'team':
      return '/team'
    case 'provider':
      return `/team/${slugOrThrow(key, params.slug)}`
    case 'store':
      return '/store'
    case 'product':
      return `/store/${slugOrThrow(key, params.slug)}`
    case 'book':
      return params.slug ? `/book/${slugOrThrow(key, params.slug)}` : '/book'
    case 'contact':
      return '/contact'
    case 'legal':
      return `/legal/${slugOrThrow(key, params.slug)}`
    case 'preview':
      if (!params.pageId || !PAGE_ID_RE.test(params.pageId))
        throw new Error('Route "preview" needs a page id')
      return `/preview/${params.pageId}`
    case 'sitemap':
      return '/sitemap.xml'
    case 'robots':
      return '/robots.txt'
    case 'favicon':
      return '/favicon.ico'
  }
}

export function withSiteBase(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  if (!b) return path
  if (path !== '/') return `${b}${path}`
  return /^https?:\/\//.test(b) ? `${b}/` : b
}

/** Safe path or null — for building links to optional entities. */
export function trySitePath(key: SiteRouteKey, params: SiteRouteParams = {}): string | null {
  try {
    return buildSitePath(key, params)
  } catch {
    return null
  }
}

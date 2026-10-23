import { RESERVED_SITE_SEGMENTS, SITE_SLUG_RE, type SiteRouteKey } from './routeKeys'
import type { SiteRouteParams } from './matchSitePath'

const slugOrThrow = (key: SiteRouteKey, slug: string | undefined): string => {
  if (!slug || !SITE_SLUG_RE.test(slug)) throw new Error(`Route "${key}" needs a valid slug`)
  return slug
}

/**
 * Site-relative path for a route key: the inverse of matchSitePath. Callers
 * prefix it with the site's base (an origin, or /s/<slug> on the app host).
 */
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
      if (!params.pageId || !/^[a-z0-9]{8,40}$/.test(params.pageId)) {
        throw new Error('Route "preview" needs a page id')
      }
      return `/preview/${params.pageId}`
    case 'sitemap':
      return '/sitemap.xml'
    case 'robots':
      return '/robots.txt'
    case 'favicon':
      return '/favicon.ico'
  }
}

/** Joins a site base ("" | "/s/everwell" | "https://everwell.example") and a site path. */
export function withSiteBase(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  if (!b) return path
  if (path !== '/') return `${b}${path}`
  // An origin's home is "https://host/"; a path base's home is "/s/slug".
  return /^https?:\/\//.test(b) ? `${b}/` : b
}

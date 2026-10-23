/**
 * The public route table of every clinic website (Component 8).
 *
 * This file is the single definition of clinic-site URLs. The backend
 * matcher (matchSitePath), the URL builder (buildSitePath) and page-slug
 * validation all read it; the frontend mirrors it in lib/site/routes.ts and
 * both are held to the same cases by shared/validation-cases/site-routes.json.
 *
 * Paths are identical on every site host (clinic subdomain or custom domain).
 * On the app host the same paths sit under /s/<clinicSlug>.
 */

export const SITE_ROUTE_KEYS = [
  'home', // /
  'page', // /<pageSlug>
  'services', // /services
  'service', // /services/<slug>
  'team', // /team
  'provider', // /team/<slug>
  'store', // /store
  'product', // /store/<slug>
  'book', // /book and /book/<serviceSlug>
  'contact', // /contact
  'legal', // /legal/<slug>
  'preview', // /preview/<pageId>?token=
  'sitemap', // /sitemap.xml
  'robots', // /robots.txt
  'favicon', // /favicon.ico
] as const

export type SiteRouteKey = (typeof SITE_ROUTE_KEYS)[number]

/** Route keys a menu or button may link to without parameters. */
export const LINKABLE_ROUTES = ['home', 'services', 'team', 'store', 'book', 'contact'] as const
export type LinkableRoute = (typeof LINKABLE_ROUTES)[number]

/**
 * First path segments a clinic page may never use as its slug: the system
 * routes above, plus app paths the edge middleware handles itself.
 */
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

/** Page / entity slug: 1–62 chars, lowercase letters, digits, inner hyphens. */
export const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/

/** Paths deeper than this are never a site route. */
export const MAX_SITE_PATH_SEGMENTS = 3

/**
 * The edge-routing decision for a request (used by middleware.ts). Pure, so
 * every host × path rule is unit-tested.
 *
 *   app host  (app.<root>, *.workers.dev, localhost)
 *     /s/<slug>/<path>   → rewrite /clinic-site/~<slug>/<path>  (path fallback)
 *     everything else    → the dashboard app, unchanged
 *   clinic host  (<label>.<root> or a verified custom domain)
 *     patient flows      → served as-is (booking, checkout, payment, account…)
 *     staff routes       → 307 to the app host
 *     static files       → served as-is
 *     everything else    → rewrite /clinic-site/<host>/<path>
 *   /clinic-site/*       → 404 when requested directly (internal tree)
 *   /clinic/<id>[/store|/p/<slug>] (first-builder URLs) → 308 to the new route
 *     on any host. Done here, not in a page: a page redirect behind a loading
 *     boundary streams as 200 + client redirect, which loses the 308 for SEO.
 */
import { classifyHost, normalizeHost, type HostEnv } from './host'

export const SITE_INTERNAL_PREFIX = '/clinic-site'
/** Request header the middleware sets on rewritten site requests: the [siteId] segment. */
export const SITE_HEADER = 'x-mf-site'

/** App routes a patient reaches from a clinic site; they stay on that host. */
export const PATIENT_PATHS = [
  '/checkout',
  '/payment',
  '/account',
  '/consultation',
  '/intake',
  '/set-password',
  // First-builder URLs (/clinic/<id>/…): they redirect to the new routes.
  '/clinic',
]
/** Staff-only app routes; on a clinic host they move to the app host. */
export const STAFF_PATHS = ['/dashboard', '/login', '/register', '/platform', '/onboarding']
/** Files with an extension that are site routes rather than static assets. */
const SITE_FILES = new Set(['/sitemap.xml', '/robots.txt', '/favicon.ico'])

export type EdgeDecision =
  | { action: 'next' }
  | { action: 'rewrite'; pathname: string }
  | { action: 'redirect'; url: string; status: 307 | 308 }
  | { action: 'notFound' }

const LEGACY_CLINIC_RE = /^\/clinic\/([A-Za-z0-9-]{1,80})(?:\/(store)|\/p\/([a-z0-9-]{1,62}))?\/?$/

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`))

export function decideEdgeRoute(input: {
  host: string | null
  pathname: string
  search: string
  appOrigin?: string | null
  env?: HostEnv
}): EdgeDecision {
  const { pathname: path, search } = input
  if (path === SITE_INTERNAL_PREFIX || path.startsWith(`${SITE_INTERNAL_PREFIX}/`)) {
    return { action: 'notFound' }
  }
  const mode = classifyHost(input.host, input.env)
  const onSite = mode.mode === 'site-subdomain' || mode.mode === 'site-custom'

  const legacy = LEGACY_CLINIC_RE.exec(path)
  if (legacy && (onSite || mode.mode === 'app')) {
    const [, idOrSlug, store, slug] = legacy
    const sitePath = store ? '/store' : slug && slug !== 'home' ? `/${slug}` : '/'
    const base = onSite ? '' : `/s/${idOrSlug!.toLowerCase()}`
    const target = onSite ? sitePath : sitePath === '/' ? base : `${base}${sitePath}`
    return { action: 'redirect', url: `${target}${search}`, status: 308 }
  }

  if (!onSite) {
    const m = /^\/s\/([a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?)(\/.*)?$/.exec(path)
    if (mode.mode === 'app' && m) {
      return { action: 'rewrite', pathname: `${SITE_INTERNAL_PREFIX}/~${m[1]}${m[2] ?? ''}` }
    }
    return { action: 'next' }
  }

  if (startsWithAny(path, PATIENT_PATHS)) return { action: 'next' }
  // The app's booking flow: /book/<serviceId>?clinicId=…
  if (path.startsWith('/book/') && new URLSearchParams(search).has('clinicId'))
    return { action: 'next' }
  if (startsWithAny(path, STAFF_PATHS)) {
    const origin = input.appOrigin?.replace(/\/+$/, '')
    return origin
      ? { action: 'redirect', url: `${origin}${path}${search}`, status: 307 }
      : { action: 'next' }
  }
  if (/\.[a-z0-9]{2,5}$/i.test(path) && !SITE_FILES.has(path.toLowerCase()))
    return { action: 'next' }

  const host = normalizeHost(input.host)!
  return {
    action: 'rewrite',
    pathname: `${SITE_INTERNAL_PREFIX}/${encodeURIComponent(host)}${path === '/' ? '' : path}`,
  }
}

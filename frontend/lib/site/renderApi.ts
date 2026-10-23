/**
 * Server-side fetch of a clinic-site page (used by app/clinic-site — runs in the
 * Worker / Node server, never in the browser). One request per page view,
 * never served from Next's data cache, so a publish is live on the next
 * request. HTTP caching belongs in front of the API (ETag + s-maxage=60 are
 * set on every render response for a CDN to use).
 */
import type { RenderPayload, RenderResponse } from './types'

export const SITE_API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(
  /\/+$/,
  ''
)

/** `[siteId]` route segment: a hostname, or "~<slug>" for the /s/<slug> fallback. */
export function siteTarget(siteParam: string): { host?: string; clinic?: string } {
  const decoded = decodeURIComponent(siteParam)
  return decoded.startsWith('~') ? { clinic: decoded.slice(1) } : { host: decoded }
}

export function siteBaseFor(siteParam: string): string {
  const t = siteTarget(siteParam)
  return t.clinic ? `/s/${t.clinic}` : ''
}

export async function fetchSitePage(
  siteParam: string,
  path: string,
  preview?: string,
  fetchImpl: typeof fetch = fetch
): Promise<RenderResponse> {
  const q = new URLSearchParams({ ...siteTarget(siteParam), path })
  if (preview) q.set('preview', preview)
  const res = await fetchImpl(`${SITE_API_BASE}/api/v1/public/sites/render?${q.toString()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as {
      code?: string
      data?: RenderPayload
    } | null
    if (body?.code === 'site_unknown' || !body?.data) return { kind: 'unknown' }
    return { kind: 'page', status: 404, payload: body.data }
  }
  if (!res.ok) throw new Error(`Site render failed (${res.status})`)
  const body = (await res.json()) as {
    data: RenderPayload | { redirect: { to: string; code: 301 | 302 } }
  }
  if ('redirect' in body.data)
    return { kind: 'redirect', to: body.data.redirect.to, code: body.data.redirect.code }
  return { kind: 'page', status: 200, payload: body.data }
}

export async function fetchSitemap(siteParam: string, fetchImpl: typeof fetch = fetch) {
  const q = new URLSearchParams(siteTarget(siteParam))
  const res = await fetchImpl(`${SITE_API_BASE}/api/v1/public/sites/sitemap?${q.toString()}`, {
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json()) as {
    data: { canonicalBase: string; entries: { loc: string; lastmod?: string }[] }
  }
  return body.data
}

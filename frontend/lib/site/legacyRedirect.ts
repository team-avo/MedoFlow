/**
 * Where a first-builder URL (/clinic/<idOrSlug>/…) now lives. On a clinic's
 * own host the site is at its root; on the app host it is /s/<idOrSlug>
 * (the API then 301s to the clinic's canonical domain if it has one).
 */
import { classifyHost, type HostEnv } from './host'

export function legacyClinicTarget(
  host: string | null,
  idOrSlug: string,
  sitePath: string,
  env?: HostEnv
): string {
  const mode = classifyHost(host, env).mode
  const path = sitePath.startsWith('/') ? sitePath : `/${sitePath}`
  if (mode === 'site-subdomain' || mode === 'site-custom') return path
  const base = `/s/${encodeURIComponent(idOrSlug.toLowerCase())}`
  return path === '/' ? base : `${base}${path}`
}

/**
 * Session handoff to a clinic's own domain (demo feedback WS1).
 *
 * A clinic site on its own domain is a different browser site from the app,
 * so the refresh cookie from an app sign-in never reaches it. The booking page
 * there bounces once through the app host, which hands back a one-time code
 * (backend services/authHandoffService.ts):
 *
 *   clinic /book            → app /auth/handoff?return=<clinic url>
 *   app /auth/handoff       → POST /auth/handoff/start → back with ?handoff=<code|none>
 *   clinic /book?handoff=…  → POST /auth/handoff/exchange → signed in here
 *
 * Pure helpers, so every rule is unit-tested.
 */
import { classifyHost, type HostEnv } from './site/host'

export const HANDOFF_PARAM = 'handoff'
export const HANDOFF_PATH = '/auth/handoff'
export const HANDOFF_RETURN_PARAM = 'return'

/** The app's own origin (NEXT_PUBLIC_APP_URL), or null when not configured. */
export function configuredAppOrigin(raw = process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/** The handoff value carried back in the URL: a code, `none`, or null when absent. */
export function readHandoffParam(href: string): string | null {
  try {
    return new URL(href).searchParams.get(HANDOFF_PARAM)
  } catch {
    return null
  }
}

/** Path + query of `href` without the handoff parameter (for router.replace). */
export function withoutHandoffParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete(HANDOFF_PARAM)
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

/**
 * Where to bounce a signed-out visitor for a handoff, or null when no bounce
 * applies: not on a clinic host, already bounced (the param is present), or
 * no app origin configured / the app is this very origin.
 */
export function handoffBounceUrl(
  href: string,
  appOrigin: string | null,
  env?: HostEnv
): string | null {
  if (!appOrigin) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.origin === appOrigin) return null
  if (url.searchParams.has(HANDOFF_PARAM)) return null
  const mode = classifyHost(url.host, env).mode
  if (mode !== 'site-subdomain' && mode !== 'site-custom') return null
  const target = new URL(HANDOFF_PATH, appOrigin)
  target.searchParams.set(HANDOFF_RETURN_PARAM, url.toString())
  return target.toString()
}

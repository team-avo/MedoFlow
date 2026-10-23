/**
 * CORS for clinic websites (B8.2). A clinic site calls the API from its own
 * origin (<label>.<root> or a verified custom domain), so the allow-list
 * can't be a fixed set of strings:
 *
 *   CORS_ORIGIN entries   exact origins          https://app.medoflow.com
 *                         one-label wildcards    https://*.medoflow.com
 *   verified SiteDomains  looked up (cached) per origin
 *
 * A wildcard matches exactly one DNS label over the same scheme:
 * "https://*.medoflow.com" allows https://everwell.medoflow.com but not
 * http://everwell.medoflow.com, https://a.b.medoflow.com or
 * https://evil-medoflow.com.
 */
import { resolveHost } from './services/hostService'
import { normalizeHost } from './routing/hosts'

export interface CorsPolicy {
  exact: Set<string>
  wildcards: { scheme: string; suffix: string }[]
}

export function parseCorsOrigins(raw: string | undefined): CorsPolicy {
  const policy: CorsPolicy = { exact: new Set(), wildcards: [] }
  for (const entry of (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)) {
    const m = /^(https?):\/\/\*\.([a-z0-9.-]+)$/i.exec(entry)
    if (m) policy.wildcards.push({ scheme: m[1]!.toLowerCase(), suffix: `.${m[2]!.toLowerCase()}` })
    else policy.exact.add(entry.replace(/\/+$/, ''))
  }
  return policy
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function matchesStaticPolicy(origin: string, policy: CorsPolicy): boolean {
  if (policy.exact.has(origin)) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.origin !== origin) return false // no paths, credentials or odd forms
  const scheme = url.protocol.replace(':', '')
  const host = url.hostname.toLowerCase()
  return policy.wildcards.some((w) => {
    if (w.scheme !== scheme || !host.endsWith(w.suffix)) return false
    const label = host.slice(0, -w.suffix.length)
    return LABEL_RE.test(label)
  })
}

/** Is `origin` a live clinic site (subdomain or verified custom domain)? */
export async function isClinicSiteOrigin(origin: string, isProduction: boolean): Promise<boolean> {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.origin !== origin) return false
  const host = normalizeHost(url.hostname)
  if (!host) return false
  const local = host === 'localhost' || host.endsWith('.localhost')
  if (url.protocol !== 'https:' && !(local && !isProduction)) return false
  const r = await resolveHost(host)
  return r.kind === 'site' || r.kind === 'alias'
}

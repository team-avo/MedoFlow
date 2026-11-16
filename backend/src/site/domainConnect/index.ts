/**
 * Domain Connect, synchronous flow (CTO-38 AC3): "Connect automatically"
 * for clinics whose DNS provider supports it (GoDaddy, Cloudflare, IONOS…).
 *
 *   1. Discovery: TXT `_domainconnect.<zone>` names the provider's host;
 *      GET https://<host>/v2/<zone>/settings gives urlSyncUX / urlAPI.
 *   2. Template check: GET <urlAPI>/v2/domainTemplates/providers/<pid>/services/<sid>
 *      (2xx = the provider has onboarded MedoFlow's template).
 *   3. Apply: the owner's browser goes to
 *      <urlSyncUX>/v2/domainTemplates/providers/<pid>/services/<sid>/apply?…
 *      signed with our RSA key (sig + key), and comes back to redirect_uri.
 *
 * Off (unavailable, `not_configured`) until DOMAIN_CONNECT_PROVIDER_ID is set.
 * The template lives in docs/domain-connect/. It only works where a DNS
 * provider has accepted it, which is a manual onboarding step per provider.
 */
import crypto from 'crypto'
import { dnsResolver, type DnsResolver } from '../domainProvider/diagnose'
import { previewSecret } from '../config'
import { safeGetJson, UnsafeUrlError, type SafeFetchDeps } from './safeFetch'

export interface DomainConnectConfig {
  providerId: string
  serviceId: string
  /** PEM RSA private key; unsigned requests when absent. */
  privateKey: string | null
  /** Host label of our public key, e.g. `_dck1` (sent as `key`). */
  keyHost: string | null
}

export function domainConnectConfig(
  env: NodeJS.ProcessEnv = process.env
): DomainConnectConfig | null {
  const providerId = env.DOMAIN_CONNECT_PROVIDER_ID?.trim()
  if (!providerId) return null
  const pem = env.DOMAIN_CONNECT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n') || null
  return {
    providerId,
    serviceId: env.DOMAIN_CONNECT_SERVICE_ID?.trim() || 'clinic-site',
    privateKey: pem,
    keyHost: env.DOMAIN_CONNECT_KEY_HOST?.trim() || null,
  }
}

export interface DiscoveredProvider {
  providerId: string
  providerName: string
  urlSyncUX: string
  urlAPI: string
}

export type ConnectAvailability =
  | { available: true; provider: DiscoveredProvider }
  | {
      available: false
      reason: 'not_configured' | 'not_supported' | 'template_missing' | 'unreachable'
    }

const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { value: ConnectAvailability; expires: number }>()
export function clearDomainConnectCache() {
  cache.clear()
}

const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

function httpsBase(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return null
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Does the DNS provider for `zone` support our template? Cached per zone for
 * ten minutes. Never throws: every failure is "unavailable" with a reason.
 */
export async function discover(
  zone: string,
  deps: SafeFetchDeps & { dns?: DnsResolver; config?: DomainConnectConfig | null } = {}
): Promise<ConnectAvailability> {
  const cfg = deps.config === undefined ? domainConnectConfig() : deps.config
  if (!cfg) return { available: false, reason: 'not_configured' }
  const key = `${cfg.providerId}/${cfg.serviceId}/${zone}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value

  const value = await (async (): Promise<ConnectAvailability> => {
    const dns = deps.dns ?? dnsResolver()
    const txt = await dns.resolveTxt(`_domainconnect.${zone}`).catch(() => [] as string[][])
    const host = (txt[0]?.join('') ?? '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
    if (!host || !HOST_RE.test(host)) return { available: false, reason: 'not_supported' }
    try {
      const settings = await safeGetJson(
        `https://${host}/v2/${encodeURIComponent(zone)}/settings`,
        deps
      )
      const s = (settings.json ?? {}) as Record<string, unknown>
      const urlSyncUX = httpsBase(s.urlSyncUX)
      const urlAPI = httpsBase(s.urlAPI)
      if (settings.status !== 200 || !urlSyncUX || !urlAPI) {
        return { available: false, reason: 'not_supported' }
      }
      const tpl = await safeGetJson(
        `${urlAPI}/v2/domainTemplates/providers/${encodeURIComponent(cfg.providerId)}/services/${encodeURIComponent(cfg.serviceId)}`,
        deps
      )
      if (tpl.status < 200 || tpl.status >= 300) {
        return { available: false, reason: 'template_missing' }
      }
      const name =
        (typeof s.providerDisplayName === 'string' && s.providerDisplayName) ||
        (typeof s.providerName === 'string' && s.providerName) ||
        host
      return {
        available: true,
        provider: {
          providerId: typeof s.providerId === 'string' ? s.providerId : host,
          providerName: String(name).slice(0, 80),
          urlSyncUX,
          urlAPI,
        },
      }
    } catch (err) {
      if (err instanceof UnsafeUrlError) return { available: false, reason: 'not_supported' }
      return { available: false, reason: 'unreachable' }
    }
  })()
  cache.set(key, { value, expires: Date.now() + TTL_MS })
  return value
}

// ─── Apply URL ──────────────────────────────────────────────────────────────

/** CSRF value bound to the domain (checked when the provider sends the owner back). */
export function connectState(domainId: string): string {
  return crypto
    .createHmac('sha256', previewSecret())
    .update(`domain-connect:${domainId}`)
    .digest('base64url')
    .slice(0, 32)
}

export function verifyConnectState(domainId: string, state: unknown): boolean {
  if (typeof state !== 'string' || state.length !== 32) return false
  const want = Buffer.from(connectState(domainId))
  const got = Buffer.from(state)
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

/** RS256 signature of the query string (Domain Connect spec: base64). */
export function signQuery(query: string, privateKeyPem: string): string {
  return crypto.sign('sha256', Buffer.from(query, 'utf8'), privateKeyPem).toString('base64')
}

/**
 * The URL that applies MedoFlow's template at the clinic's DNS provider:
 * CNAME <host> → target and the `_medoflow-verify` TXT, then back to us.
 */
export function buildApplyUrl(input: {
  provider: DiscoveredProvider
  config: DomainConnectConfig
  zone: string
  /** Host relative to the zone, e.g. `www`. */
  host: string
  target: string
  token: string
  redirectUri: string
  state: string
}): string {
  const q = new URLSearchParams()
  q.set('domain', input.zone)
  q.set('host', input.host)
  q.set('target', input.target)
  q.set('token', input.token)
  q.set('redirect_uri', input.redirectUri)
  q.set('state', input.state)
  let query = q.toString()
  if (input.config.privateKey && input.config.keyHost) {
    const sig = signQuery(query, input.config.privateKey)
    query += `&key=${encodeURIComponent(input.config.keyHost)}&sig=${encodeURIComponent(sig)}`
  }
  const base = input.provider.urlSyncUX.replace(/\/+$/, '')
  return `${base}/v2/domainTemplates/providers/${encodeURIComponent(input.config.providerId)}/services/${encodeURIComponent(input.config.serviceId)}/apply?${query}`
}

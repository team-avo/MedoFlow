import { domainProviderName } from '../config'
import { CloudflareDomainProvider } from './cloudflare'
import { ManualDomainProvider } from './manual'
import type { DomainProvider } from './types'

export type { DomainProvider, DnsRecord, DomainCheck } from './types'
export { ManualDomainProvider } from './manual'
export { CloudflareDomainProvider } from './cloudflare'

let override: DomainProvider | null = null

/** The configured provider (DOMAIN_PROVIDER). */
export function getDomainProvider(env: NodeJS.ProcessEnv = process.env): DomainProvider {
  if (override) return override
  if (domainProviderName(env) === 'cloudflare') {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
      throw new Error('DOMAIN_PROVIDER=cloudflare needs CF_API_TOKEN and CF_ZONE_ID')
    }
    return new CloudflareDomainProvider({
      apiToken: env.CF_API_TOKEN,
      zoneId: env.CF_ZONE_ID,
      apiBase: env.CF_API_BASE,
    })
  }
  return new ManualDomainProvider()
}

/** Test seam: route domain registration/checks to a stub (null restores). */
export function setDomainProviderForTests(p: DomainProvider | null): void {
  override = p
}

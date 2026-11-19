import { domainProviderName } from '../config'
import { pagesConfig } from '../frontDoor/cfApi'
import { CloudflareDomainProvider } from './cloudflare'
import { ManualDomainProvider } from './manual'
import { PagesDomainProvider } from './pages'
import type { DomainProvider } from './types'

export type { DomainProvider, DnsRecord, DomainCheck, RecordCheck } from './types'
export { ManualDomainProvider } from './manual'
export { CloudflareDomainProvider } from './cloudflare'
export { PagesDomainProvider } from './pages'

let override: DomainProvider | null = null

/** The configured provider (DOMAIN_PROVIDER). */
export function getDomainProvider(env: NodeJS.ProcessEnv = process.env): DomainProvider {
  if (override) return override
  const name = domainProviderName(env)
  if (name === 'cloudflare') {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
      throw new Error('DOMAIN_PROVIDER=cloudflare needs CF_API_TOKEN and CF_ZONE_ID')
    }
    return new CloudflareDomainProvider({
      apiToken: env.CF_API_TOKEN,
      zoneId: env.CF_ZONE_ID,
      apiBase: env.CF_API_BASE,
    })
  }
  if (name === 'pages') {
    const cfg = pagesConfig(env)
    if (!cfg) throw new Error('DOMAIN_PROVIDER=pages needs CF_PAGES_API_TOKEN and CF_ACCOUNT_ID')
    return new PagesDomainProvider(cfg)
  }
  return new ManualDomainProvider()
}

/** Test seam: route domain registration/checks to a stub (null restores). */
export function setDomainProviderForTests(p: DomainProvider | null): void {
  override = p
}

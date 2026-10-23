/** A DNS record the clinic must create at its DNS provider. */
export interface DnsRecord {
  type: 'CNAME' | 'TXT' | 'A' | 'AAAA'
  name: string
  value: string
  purpose: 'routing' | 'ownership' | 'certificate'
}

export interface DomainRegistration {
  /** Provider-side id (Cloudflare custom-hostname id); null for manual. */
  providerRef: string | null
  records: DnsRecord[]
  sslStatus: string | null
}

export interface DomainCheck {
  status: 'VERIFIED' | 'PENDING' | 'FAILED'
  sslStatus: string | null
  records: DnsRecord[]
  error: string | null
}

export interface DomainRecordInput {
  hostname: string
  verifyToken: string
  providerRef: string | null
}

/**
 * Where custom domains are registered and checked (B8.2).
 *   manual      the clinic points DNS at us; we check TXT + CNAME ourselves.
 *               TLS for the domain is the operator's job (see the Cloudflare
 *               guide). Works with no API token — local dev and small setups.
 *   cloudflare  Cloudflare for SaaS: each domain becomes a custom hostname on
 *               our zone; Cloudflare validates ownership and issues the
 *               certificate. Fully automatic.
 */
export interface DomainProvider {
  readonly name: 'manual' | 'cloudflare'
  register(input: DomainRecordInput): Promise<DomainRegistration>
  check(input: DomainRecordInput): Promise<DomainCheck>
  remove(input: DomainRecordInput): Promise<void>
}

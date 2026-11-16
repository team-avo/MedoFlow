/** A DNS record the clinic must create at its DNS provider. */
export interface DnsRecord {
  type: 'CNAME' | 'TXT' | 'A' | 'AAAA'
  /** Fully qualified name, e.g. `_medoflow-verify.www.clinic.com`. */
  name: string
  value: string
  purpose: 'routing' | 'ownership' | 'certificate'
  /**
   * The name relative to the clinic's DNS zone, as most DNS providers want
   * it typed (`www`, `_medoflow-verify.www`, `@` for the zone itself).
   * CTO-38; absent when the zone is unknown.
   */
  host?: string
}

/** What we found for one required record (CTO-38). Hostnames and values only. */
export interface RecordCheck {
  type: DnsRecord['type'] | 'CAA'
  name: string
  purpose: DnsRecord['purpose']
  ok: boolean
  /** The values DNS answered with right now (empty when nothing was found). */
  found: string[]
  /** A plain-language problem, or null when the record is right. */
  message: string | null
}

export interface DomainRegistration {
  /** Provider-side id (Cloudflare custom-hostname id); null for manual. */
  providerRef: string | null
  records: DnsRecord[]
  sslStatus: string | null
}

export interface DomainCheck {
  status: 'VERIFIED' | 'PENDING' | 'FAILED'
  /**
   * Certificate state: null (we don't manage TLS), 'pending', 'active', or
   * 'blocked' / 'error' when the provider refuses the domain.
   */
  sslStatus: string | null
  records: DnsRecord[]
  error: string | null
  /** Per-record diagnostics (CTO-38). */
  checks?: RecordCheck[]
  /** The provider asked Cloudflare to re-validate during this check. */
  retried?: boolean
}

export interface DomainRecordInput {
  hostname: string
  verifyToken: string
  providerRef: string | null
  /** Last time the provider asked Cloudflare to re-validate (throttle). */
  lastRetryAt?: Date | null
}

export type DomainProviderKind = 'manual' | 'cloudflare' | 'pages'

/**
 * Where custom domains are registered and checked (B8.2, CTO-38).
 *   manual      the clinic points DNS at us; we check TXT + CNAME ourselves.
 *               TLS for the domain is the operator's job. Works with no API
 *               token, local dev and small setups.
 *   cloudflare  Cloudflare for SaaS: each domain becomes a custom hostname on
 *               our zone; Cloudflare validates ownership and issues the
 *               certificate. Needs a zone MedoFlow owns.
 *   pages       Cloudflare Pages custom domains on the `medoflow` project
 *               (zero cost, 100 per project): we check TXT + CNAME, Cloudflare
 *               issues the certificate, the front door serves the site.
 */
export interface DomainProvider {
  readonly name: DomainProviderKind
  register(input: DomainRecordInput): Promise<DomainRegistration>
  check(input: DomainRecordInput): Promise<DomainCheck>
  remove(input: DomainRecordInput): Promise<void>
}

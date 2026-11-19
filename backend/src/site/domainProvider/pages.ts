/**
 * Cloudflare Pages custom domains (CTO-38): the zero-cost way to give a
 * clinic's own domain HTTPS while MedoFlow owns no zone. Each clinic domain
 * is added to the `medoflow` Pages project; the clinic CNAMEs it to
 * `<project>.pages.dev`; Cloudflare validates it and issues the certificate;
 * the project's production front door hands the request to the app Worker,
 * which serves the clinic whose verified domain it is (ADR 0005).
 *
 *   POST   /accounts/:acct/pages/projects/:project/domains          add
 *   GET    /accounts/:acct/pages/projects/:project/domains/:name    status
 *   PATCH  /accounts/:acct/pages/projects/:project/domains/:name    retry validation
 *   DELETE /accounts/:acct/pages/projects/:project/domains/:name    remove
 *
 * Token: CF_PAGES_API_TOKEN (Account · Cloudflare Pages · Edit), the same one
 * the front-door launcher uses. Limit: 100 custom domains per project (Free).
 *
 * Ownership stays ours: the `_medoflow-verify` TXT must be present before a
 * domain counts as VERIFIED, so nobody can claim a hostname they don't own.
 */
import {
  cfCall,
  PagesError,
  projectPath,
  type FetchLike,
  type PagesConfig,
} from '../frontDoor/cfApi'
import {
  checkRecords,
  dnsResolver,
  ownershipRecord,
  routingRecord,
  type DnsResolver,
} from './diagnose'
import type { DomainCheck, DomainProvider, DomainRecordInput, DomainRegistration } from './types'

/** The domain object Cloudflare returns (fields we use). */
interface PagesDomain {
  id?: string
  name: string
  status?: 'initializing' | 'pending' | 'active' | 'deactivated' | 'blocked' | 'error'
  validation_data?: { status?: string; method?: string; error_message?: string }
  verification_data?: { status?: string; error_message?: string }
}

/** Re-ask Cloudflare to validate at most this often. */
export const RETRY_EVERY_MS = 10 * 60 * 1000

/** Cloudflare's "you've hit the custom-domain limit" answer. */
export const isCapacityError = (err: unknown) =>
  err instanceof PagesError && /limit|maximum|quota|too many/i.test(err.message)

const alreadyExists = (err: unknown) =>
  err instanceof PagesError && (err.status === 409 || /already (exists|added)/i.test(err.message))

export class PagesDomainProvider implements DomainProvider {
  readonly name = 'pages' as const

  constructor(
    private readonly cfg: PagesConfig,
    private readonly opts: { fetch?: FetchLike; dns?: DnsResolver; now?: () => Date } = {}
  ) {}

  /** What clinics CNAME to: the project's production address. */
  get target() {
    return `${this.cfg.project}.pages.dev`
  }

  private call<T>(path: string, init: RequestInit): Promise<T> {
    return cfCall<T>(this.cfg, path, init, this.opts.fetch)
  }

  private domainPath(name?: string) {
    const base = `${projectPath(this.cfg)}/domains`
    return name ? `${base}/${encodeURIComponent(name)}` : base
  }

  private records(input: DomainRecordInput) {
    return [routingRecord(input.hostname), ownershipRecord(input.hostname, input.verifyToken)]
  }

  private add(hostname: string): Promise<PagesDomain> {
    return this.call<PagesDomain>(this.domainPath(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: hostname }),
    })
  }

  /** Adds the domain to the project. Idempotent: an existing domain is fetched instead. */
  async register(input: DomainRecordInput): Promise<DomainRegistration> {
    let d: PagesDomain
    try {
      d = await this.add(input.hostname)
    } catch (err) {
      if (!alreadyExists(err)) throw err
      d = await this.call<PagesDomain>(this.domainPath(input.hostname), { method: 'GET' })
    }
    return {
      providerRef: d.id ?? d.name ?? input.hostname,
      records: this.records(input),
      sslStatus: d.status === 'active' ? 'active' : 'pending',
    }
  }

  async check(input: DomainRecordInput): Promise<DomainCheck> {
    const records = this.records(input)
    const dns = await checkRecords(
      { hostname: input.hostname, token: input.verifyToken, target: this.target },
      this.opts.dns ?? dnsResolver()
    )
    if (!dns.ok) {
      return { status: 'FAILED', sslStatus: null, records, error: dns.error, checks: dns.checks }
    }

    // DNS is right: ask Cloudflare where the certificate stands.
    let d: PagesDomain
    try {
      d = await this.call<PagesDomain>(this.domainPath(input.hostname), { method: 'GET' })
    } catch (err) {
      if (!(err instanceof PagesError) || err.status !== 404) throw err
      // Removed on the Cloudflare side (or never added): add it again.
      d = await this.add(input.hostname)
    }

    const cfError = d.validation_data?.error_message || d.verification_data?.error_message || null
    if (d.status === 'active') {
      return { status: 'VERIFIED', sslStatus: 'active', records, error: null, checks: dns.checks }
    }
    if (d.status === 'blocked') {
      return {
        status: 'VERIFIED',
        sslStatus: 'blocked',
        records,
        error: `Cloudflare blocked ${input.hostname}${cfError ? `: ${cfError}` : ''}. Contact MedoFlow support`,
        checks: dns.checks,
      }
    }
    let retried = false
    if (d.status === 'error' || d.status === 'deactivated') {
      const now = (this.opts.now ?? (() => new Date()))()
      const last = input.lastRetryAt?.getTime() ?? 0
      if (now.getTime() - last >= RETRY_EVERY_MS) {
        await this.call(this.domainPath(input.hostname), { method: 'PATCH' })
        retried = true
      }
    }
    const caa = dns.checks.find((c) => c.type === 'CAA' && !c.ok)
    return {
      status: 'VERIFIED',
      sslStatus: 'pending',
      records,
      error:
        caa?.message ??
        (cfError
          ? `Cloudflare: ${cfError}`
          : retried
            ? 'Cloudflare is re-checking the domain'
            : 'Cloudflare is issuing the HTTPS certificate (usually a few minutes)'),
      checks: dns.checks,
      retried,
    }
  }

  async remove(input: DomainRecordInput): Promise<void> {
    try {
      await this.call(this.domainPath(input.hostname), { method: 'DELETE' })
    } catch (err) {
      if (err instanceof PagesError && err.status === 404) return
      throw err
    }
  }
}

/**
 * Cloudflare for SaaS custom hostnames (B8.2). Each clinic domain becomes a
 * custom hostname on our SaaS zone; Cloudflare checks ownership and issues a
 * DV certificate, and the zone's `*\/*` Worker route serves it. API:
 *   POST   /zones/:zone/custom_hostnames          create
 *   GET    /zones/:zone/custom_hostnames/:id      status (pending → active)
 *   DELETE /zones/:zone/custom_hostnames/:id      remove
 * Token scope: Zone › SSL and Certificates › Edit, on the SaaS zone only.
 */
import { routingRecord } from './manual'
import type {
  DnsRecord,
  DomainCheck,
  DomainProvider,
  DomainRecordInput,
  DomainRegistration,
} from './types'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface CfCustomHostname {
  id: string
  hostname: string
  status: string
  ssl?: {
    status?: string
    validation_records?: { txt_name?: string; txt_value?: string }[]
    validation_errors?: { message?: string }[]
  }
  ownership_verification?: { type?: string; name?: string; value?: string }
  verification_errors?: string[]
}

interface CfEnvelope<T> {
  success: boolean
  errors?: { code?: number; message?: string }[]
  result: T
}

export class CloudflareDomainProvider implements DomainProvider {
  readonly name = 'cloudflare' as const

  constructor(
    private readonly opts: { apiToken: string; zoneId: string; apiBase?: string; fetch?: FetchLike }
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const base = (this.opts.apiBase ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '')
    const doFetch = this.opts.fetch ?? fetch
    const res = await doFetch(`${base}/zones/${this.opts.zoneId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null
    if (!res.ok || !json?.success) {
      const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`
      throw new Error(`Cloudflare API: ${msg}`)
    }
    return json.result
  }

  private records(input: DomainRecordInput, ch: CfCustomHostname | null): DnsRecord[] {
    const out: DnsRecord[] = [routingRecord(input.hostname)]
    const own = ch?.ownership_verification
    if (own?.name && own.value) {
      out.push({ type: 'TXT', name: own.name, value: own.value, purpose: 'ownership' })
    }
    for (const v of ch?.ssl?.validation_records ?? []) {
      if (v.txt_name && v.txt_value) {
        out.push({ type: 'TXT', name: v.txt_name, value: v.txt_value, purpose: 'certificate' })
      }
    }
    return out
  }

  async register(input: DomainRecordInput): Promise<DomainRegistration> {
    const ch = await this.call<CfCustomHostname>('POST', '/custom_hostnames', {
      hostname: input.hostname,
      ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
    })
    return {
      providerRef: ch.id,
      records: this.records(input, ch),
      sslStatus: ch.ssl?.status ?? null,
    }
  }

  async check(input: DomainRecordInput): Promise<DomainCheck> {
    if (!input.providerRef) {
      return { status: 'FAILED', sslStatus: null, records: [], error: 'Domain is not registered' }
    }
    const ch = await this.call<CfCustomHostname>('GET', `/custom_hostnames/${input.providerRef}`)
    const sslStatus = ch.ssl?.status ?? null
    const records = this.records(input, ch)
    if (ch.status === 'active' && sslStatus === 'active') {
      return { status: 'VERIFIED', sslStatus, records, error: null }
    }
    const errs = [
      ...(ch.verification_errors ?? []),
      ...(ch.ssl?.validation_errors ?? []).map((e) => e.message ?? ''),
    ].filter(Boolean)
    return {
      status: errs.length && ch.status !== 'pending' ? 'FAILED' : 'PENDING',
      sslStatus,
      records,
      error:
        errs.join('; ') ||
        `Waiting for Cloudflare (hostname ${ch.status}, certificate ${sslStatus})`,
    }
  }

  async remove(input: DomainRecordInput): Promise<void> {
    if (!input.providerRef) return
    await this.call('DELETE', `/custom_hostnames/${input.providerRef}`)
  }
}

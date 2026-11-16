import { checkRecords, dnsResolver, ownershipRecord, routingRecord } from './diagnose'
import type { DnsResolver } from './diagnose'
import type { DomainCheck, DomainProvider, DomainRecordInput } from './types'

export type { DnsResolver } from './diagnose'
export { VERIFY_PREFIX, ownershipRecord, routingRecord } from './diagnose'

/**
 * The clinic points DNS at us and we check the TXT + CNAME ourselves
 * (diagnose.ts). No certificate is issued: TLS is the operator's job.
 */
export class ManualDomainProvider implements DomainProvider {
  readonly name = 'manual' as const
  constructor(private readonly dns?: DnsResolver) {}

  register(input: DomainRecordInput) {
    return Promise.resolve({
      providerRef: null,
      records: [routingRecord(input.hostname), ownershipRecord(input.hostname, input.verifyToken)],
      sslStatus: null,
    })
  }

  async check(input: DomainRecordInput): Promise<DomainCheck> {
    const records = [
      routingRecord(input.hostname),
      ownershipRecord(input.hostname, input.verifyToken),
    ]
    const r = await checkRecords(
      { hostname: input.hostname, token: input.verifyToken },
      this.dns ?? dnsResolver()
    )
    return {
      status: r.ok ? 'VERIFIED' : 'FAILED',
      sslStatus: null,
      records,
      error: r.ok ? null : r.error,
      checks: r.checks,
    }
  }

  remove() {
    return Promise.resolve()
  }
}

import { promises as dnsPromises } from 'dns'
import { siteCnameTarget } from '../config'
import type { DnsRecord, DomainCheck, DomainProvider, DomainRecordInput } from './types'

/** The subset of dns.promises the check uses; injectable for tests. */
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>
  resolveCname(name: string): Promise<string[]>
  resolve4(name: string): Promise<string[]>
}

export const VERIFY_PREFIX = '_medoflow-verify'

export function ownershipRecord(hostname: string, token: string): DnsRecord {
  return {
    type: 'TXT',
    name: `${VERIFY_PREFIX}.${hostname}`,
    value: `medoflow-verify=${token}`,
    purpose: 'ownership',
  }
}

export function routingRecord(hostname: string): DnsRecord {
  return { type: 'CNAME', name: hostname, value: siteCnameTarget(), purpose: 'routing' }
}

const swallow = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p
  } catch {
    return fallback
  }
}

const norm = (h: string) => h.toLowerCase().replace(/\.$/, '')

export class ManualDomainProvider implements DomainProvider {
  readonly name = 'manual' as const
  constructor(private readonly dns: DnsResolver = dnsPromises) {}

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
    const own = records[1]!
    const txt = (await swallow(this.dns.resolveTxt(own.name), [] as string[][])).map((c) =>
      c.join('')
    )
    if (!txt.includes(own.value)) {
      return {
        status: 'FAILED',
        sslStatus: null,
        records,
        error: `TXT record ${own.name} not found yet (DNS changes can take up to an hour)`,
      }
    }
    const target = norm(siteCnameTarget())
    const cnames = (await swallow(this.dns.resolveCname(input.hostname), [] as string[])).map(norm)
    if (!cnames.includes(target)) {
      // Apex domains can't hold a CNAME; accept a flattened record (ALIAS /
      // ANAME / CNAME flattening) that resolves to the same addresses.
      const [mine, theirs] = await Promise.all([
        swallow(this.dns.resolve4(input.hostname), [] as string[]),
        swallow(this.dns.resolve4(target), [] as string[]),
      ])
      const flattened = mine.length > 0 && mine.every((ip) => theirs.includes(ip))
      if (!flattened) {
        return {
          status: 'FAILED',
          sslStatus: null,
          records,
          error: `${input.hostname} must be a CNAME to ${target}`,
        }
      }
    }
    return { status: 'VERIFIED', sslStatus: null, records, error: null }
  }

  remove() {
    return Promise.resolve()
  }
}

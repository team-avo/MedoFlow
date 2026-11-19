/**
 * Outbound fetch for Domain Connect discovery (CTO-38). The host we call is
 * read from the clinic's own DNS (`_domainconnect` TXT), so it is untrusted:
 *   - https only, a hostname (never an IP literal), standard port;
 *   - every address it resolves to must be public (no private, loopback,
 *     link-local, CGNAT, multicast or reserved ranges);
 *   - no redirects, a 5 s timeout and a 32 KB body cap.
 * Residual risk: DNS can change between our lookup and fetch's own (rebinding).
 * The answer is only parsed as JSON and never shown raw, which bounds it.
 */
import { promises as dnsPromises } from 'dns'
import { BlockList, isIP } from 'net'

const TIMEOUT_MS = 5_000
export const MAX_BODY_BYTES = 32 * 1024

const BLOCKED = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv4')
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv6')
}

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return !BLOCKED.check(ip, 'ipv4')
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
    if (mapped) return isPublicAddress(mapped[1]!)
    return !BLOCKED.check(ip, 'ipv6')
  }
  return false
}

export type Lookup = (host: string) => Promise<Array<{ address: string }>>

const defaultLookup: Lookup = (host) => dnsPromises.lookup(host, { all: true, verbatim: true })

export class UnsafeUrlError extends Error {}

export interface SafeFetchDeps {
  fetch?: typeof fetch
  lookup?: Lookup
}

/** GETs an untrusted https URL and returns status + JSON (or null). Throws UnsafeUrlError. */
export async function safeGetJson(
  raw: string,
  deps: SafeFetchDeps = {}
): Promise<{ status: number; json: unknown }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('not a URL')
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('https only')
  if (url.username || url.password) throw new UnsafeUrlError('credentials in URL')
  if (url.port && url.port !== '443') throw new UnsafeUrlError('non-standard port')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) throw new UnsafeUrlError('IP addresses are not allowed')
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) throw new UnsafeUrlError('bad host')

  const addrs = await (deps.lookup ?? defaultLookup)(host).catch(() => [])
  if (!addrs.length) throw new UnsafeUrlError('host does not resolve')
  if (!addrs.every((a) => isPublicAddress(a.address))) {
    throw new UnsafeUrlError('host resolves to a private address')
  }

  const res = await (deps.fetch ?? fetch)(url.toString(), {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status >= 300 && res.status < 400) throw new UnsafeUrlError('redirects are not followed')

  const reader = res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    for (;;) {
      const chunk = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (chunk.done || !chunk.value) break
      const value = chunk.value
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new UnsafeUrlError('response too large')
      }
      chunks.push(value)
    }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json }
}

/**
 * CTO-40: outbound HTTPS to addresses a clinic typed in (a WooCommerce store
 * URL) or that came from imported data (product image URLs). Server-side
 * request forgery guard:
 *
 *  - https only, default port only;
 *  - every address the host resolves to must be public: loopback, private,
 *    link-local (cloud metadata), CGNAT, multicast and reserved ranges are
 *    refused. The check runs inside the socket's own DNS lookup, so the
 *    address that is checked is the address that is connected to (no
 *    DNS-rebinding gap);
 *  - redirects are followed by hand (at most 3) and each hop is checked
 *    again; credentials are never sent to another origin;
 *  - a response body cap and a whole-request timeout.
 */
import dns from 'dns'
import https from 'https'
import net from 'net'
import type { LookupFunction } from 'net'
import { ImportSourceError } from './types'

export interface SafeRequest {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export interface SafeResponse {
  status: number
  headers: Record<string, string>
  body: Buffer
  /** The URL that finally answered (after redirects). */
  url: string
}

export type SafeTransport = (url: string, req: SafeRequest) => Promise<SafeResponse>

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

// ─── Address checks ──────────────────────────────────────────────────────────

const v4ToInt = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip)
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mask) === (v4ToInt(base) & mask)
  })
}

/** Expands an IPv6 address into 8 numbers. */
function v6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0]!
  // Embedded IPv4 (::ffff:1.2.3.4).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr)
  if (v4) {
    const n = v4ToInt(v4[1]!)
    addr = addr.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = addr.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  if (tail === undefined && h.length !== 8) return null
  const fill = 8 - h.length - t.length
  if (fill < 0) return null
  const zeros: string[] = new Array<string>(tail !== undefined ? fill : 0).fill('0')
  const groups = [...h, ...zeros, ...t].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null
}

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip)
  if (!g) return false
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: check the IPv4 part.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicV4(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return false // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return false // fe80::/10 link local
  if ((g[0]! & 0xff00) === 0xff00) return false // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false // documentation
  return true
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return isPublicV4(ip)
  if (kind === 6) return isPublicV6(ip)
  return false
}

const BLOCKED_HOSTNAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i

/** Checks the URL's shape (not its DNS). Throws a safe ImportSourceError. */
export function assertSafeUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new ImportSourceError('That address is not a valid URL', 'unsafe_url', false)
  }
  if (u.protocol !== 'https:') {
    throw new ImportSourceError('Only https:// addresses can be used', 'unsafe_url', false)
  }
  if (u.username || u.password) {
    throw new ImportSourceError(
      'Addresses with a user name or password are not allowed',
      'unsafe_url',
      false
    )
  }
  if (u.port && u.port !== '443') {
    throw new ImportSourceError('Only the standard https port can be used', 'unsafe_url', false)
  }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (
    net.isIP(host) ? !isPublicAddress(host) : BLOCKED_HOSTNAMES.test(host) || !host.includes('.')
  ) {
    throw new ImportSourceError('That address points to a private network', 'unsafe_url', false)
  }
  return u
}

/** dns.lookup that refuses non-public answers (used by the socket itself). */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 4)
    const list: dns.LookupAddress[] = Array.isArray(addresses) ? addresses : []
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const e = new Error('blocked_private_address') as NodeJS.ErrnoException
      e.code = 'EBLOCKED'
      return callback(e, '', 4)
    }
    if (options.all) return callback(null, list as unknown as string, 4)
    return callback(null, list[0]!.address, list[0]!.family)
  })
}

// ─── Transport ───────────────────────────────────────────────────────────────

function once(u: URL, req: SafeRequest, deadline: number): Promise<SafeResponse> {
  const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES
  return new Promise((resolve, reject) => {
    const remaining = Math.max(1, deadline - Date.now())
    const r = https.request(
      u,
      {
        method: req.method ?? 'GET',
        headers: { 'user-agent': 'MedoFlow-CatalogImport/1.0', ...(req.headers ?? {}) },
        lookup: publicOnlyLookup,
        timeout: remaining,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > maxBytes) {
            res.destroy()
            reject(new ImportSourceError('The response was too large', 'too_large', false))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
            url: u.toString(),
          })
        })
        res.on('error', () =>
          reject(new ImportSourceError('The connection was interrupted', 'network'))
        )
      }
    )
    r.on('timeout', () => {
      r.destroy()
      reject(new ImportSourceError('The store took too long to answer', 'timeout'))
    })
    r.on('error', (err: NodeJS.ErrnoException) => {
      if (err instanceof ImportSourceError) return reject(err)
      if (err.code === 'EBLOCKED' || err.message === 'blocked_private_address') {
        return reject(
          new ImportSourceError('That address points to a private network', 'unsafe_url', false)
        )
      }
      if (err.code === 'ENOTFOUND') {
        return reject(new ImportSourceError('That address could not be found', 'not_found', false))
      }
      reject(new ImportSourceError('The store could not be reached', 'network'))
    })
    if (req.body) r.write(req.body)
    r.end()
  })
}

const realTransport: SafeTransport = async (url, req) => {
  const deadline = Date.now() + (req.timeoutMs ?? DEFAULT_TIMEOUT)
  let current = assertSafeUrl(url)
  const origin = current.origin
  let headers = req.headers
  for (let hop = 0; ; hop++) {
    const res = await once(current, { ...req, headers }, deadline)
    const location = res.headers.location
    if (res.status < 300 || res.status >= 400 || !location) return res
    if (hop >= (req.maxRedirects ?? 3)) {
      throw new ImportSourceError('Too many redirects', 'redirects', false)
    }
    current = assertSafeUrl(new URL(location, current).toString())
    // Never send credentials to a different origin.
    if (current.origin !== origin && headers) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => !/^(authorization|cookie|x-api-key)$/i.test(k))
      )
    }
  }
}

let transport: SafeTransport = realTransport

/** Tests: replace the network (null restores it). */
export function setSafeTransportForTests(t: SafeTransport | null) {
  transport = t ?? realTransport
}

/** An SSRF-guarded HTTPS request. Shape checks always run, even under test. */
export async function safeRequest(url: string, req: SafeRequest = {}): Promise<SafeResponse> {
  assertSafeUrl(url)
  return transport(url, req)
}

/**
 * CTO-40: HTTP to the fixed provider APIs (Shopify, Square, Wix). These hosts
 * are ours to choose, not typed by a clinic, so the plain fetch is used (the
 * WooCommerce store URL goes through catalogImport/safeHttp instead).
 *
 *  - 10 s timeout per call;
 *  - 429 and 5xx are retried twice, honouring Retry-After up to 10 s;
 *  - errors carry a short safe message, never a token or a response body.
 */
import { ImportSourceError } from '../catalogImport/types'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

let fetchImpl: FetchLike = (url, init) => fetch(url, init)

/** Tests: replace the network (null restores it). */
export function setProviderFetchForTests(f: FetchLike | null) {
  fetchImpl = f ?? ((url, init) => fetch(url, init))
}

const TIMEOUT_MS = 10_000
const RETRIES = 2

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ProviderCall {
  method?: 'GET' | 'POST' | 'DELETE'
  headers?: Record<string, string>
  json?: unknown
  /** Label for errors ("Shopify"). */
  provider: string
}

export async function providerFetch<T = unknown>(url: string, call: ProviderCall): Promise<T> {
  let attempt = 0
  for (;;) {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: call.method ?? (call.json === undefined ? 'GET' : 'POST'),
        headers: {
          accept: 'application/json',
          ...(call.json === undefined ? {} : { 'content-type': 'application/json' }),
          ...(call.headers ?? {}),
        },
        body: call.json === undefined ? undefined : JSON.stringify(call.json),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      if (attempt++ < RETRIES) {
        await sleep(500 * attempt)
        continue
      }
      throw new ImportSourceError(`${call.provider} could not be reached`, 'network')
    }
    if ((res.status === 429 || res.status >= 500) && attempt++ < RETRIES) {
      const after = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 1000 * attempt)
      continue
    }
    if (res.status === 401 || res.status === 403) {
      throw new ImportSourceError(
        `${call.provider} refused the connection. Reconnect the store`,
        'unauthorized',
        false
      )
    }
    if (!res.ok) {
      throw new ImportSourceError(
        `${call.provider} answered with an error (${res.status})`,
        'http_error'
      )
    }
    if (res.status === 204) return undefined as T
    try {
      return (await res.json()) as T
    } catch {
      throw new ImportSourceError(`${call.provider} sent an unreadable answer`, 'bad_response')
    }
  }
}

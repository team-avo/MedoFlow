/**
 * CTO-40: the OAuth `state` for store connections. A signed, expiring token
 * bound to the clinic, the user who started the flow, and the provider:
 *
 *   base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
 *
 * It protects the callback against CSRF (a state minted for one user or
 * clinic is refused for another) and carries the shop or store address
 * through the provider's redirect. It holds no secrets.
 */
import crypto from 'crypto'
import type { StoreProvider } from '../catalogImport/types'

export const STATE_TTL_MS = 10 * 60 * 1000

export interface StatePayload {
  clinicId: string
  userId: string
  provider: StoreProvider
  /** Shop domain or store URL the flow is for. */
  account?: string
  nonce: string
  exp: number
}

let devKey: Buffer | undefined

function stateKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.STORE_CONNECT_STATE_SECRET || env.JWT_SECRET
  if (secret) return crypto.createHash('sha256').update(`store-connect:${secret}`).digest()
  return (devKey ??= crypto.randomBytes(32))
}

const sign = (body: string) =>
  crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')

export function signState(
  p: Omit<StatePayload, 'nonce' | 'exp'>,
  now: number = Date.now()
): string {
  const payload: StatePayload = {
    ...p,
    nonce: crypto.randomBytes(12).toString('base64url'),
    exp: now + STATE_TTL_MS,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

/** The payload, or null when the state is forged, altered or expired. */
export function verifyState(state: unknown, now: number = Date.now()): StatePayload | null {
  if (typeof state !== 'string' || state.length > 2_000) return null
  const [body, mac, extra] = state.split('.')
  if (!body || !mac || extra !== undefined) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
    if (typeof p.exp !== 'number' || p.exp < now) return null
    if (typeof p.clinicId !== 'string' || typeof p.userId !== 'string') return null
    return p
  } catch {
    return null
  }
}

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second step, 6 digits) — what Google
 * Authenticator, 1Password, Authy and Microsoft Authenticator use. Built on
 * node:crypto so no third-party code sits in the MFA path.
 */
import crypto from 'crypto'

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('Invalid base32 character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** 160-bit random secret, base32-encoded (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

export function timeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS)
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    10 ** DIGITS
  return code.toString().padStart(DIGITS, '0')
}

/**
 * Checks a code against the current step ±1 (clock skew). Returns the
 * matched step so the caller can reject replays (a step ≤ the last one used),
 * or null if the code is wrong.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  window = 1
): number | null {
  const normalized = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return null
  const current = timeStep(nowMs)
  for (let delta = -window; delta <= window; delta++) {
    const candidate = totpAt(secret, current + delta)
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
      return current + delta
    }
  }
  return null
}

export function otpauthUrl(secret: string, accountName: string, issuer = 'MedoFlow'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

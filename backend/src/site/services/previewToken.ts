/**
 * Draft-preview links (B8.6). A token lets anyone holding the link view one
 * page's draft for 30 minutes — so the owner can check it on the real site
 * host or send it to a colleague — without publishing. HMAC-SHA256 over
 * clinic, page and expiry; constant-time comparison.
 */
import crypto from 'crypto'
import { previewSecret } from '../config'

export const PREVIEW_TTL_SECONDS = 30 * 60

const b64 = (b: Buffer) => b.toString('base64url')

function sign(payload: string): string {
  return b64(crypto.createHmac('sha256', previewSecret()).update(payload).digest())
}

export function createPreviewToken(
  clinicId: string,
  pageId: string,
  nowMs = Date.now()
): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + PREVIEW_TTL_SECONDS
  const payload = `${clinicId}.${pageId}.${exp}`
  return {
    token: `${b64(Buffer.from(payload, 'utf8'))}.${sign(payload)}`,
    expiresAt: new Date(exp * 1000),
  }
}

/** The page the token grants, or null when forged, altered or expired. */
export function verifyPreviewToken(
  token: string,
  nowMs = Date.now()
): { clinicId: string; pageId: string } | null {
  if (typeof token !== 'string' || token.length > 400) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  let payload: string
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  const [clinicId, pageId, expRaw] = payload.split('.')
  const exp = Number(expRaw)
  if (!clinicId || !pageId || !Number.isFinite(exp) || exp * 1000 < nowMs) return null
  return { clinicId, pageId }
}

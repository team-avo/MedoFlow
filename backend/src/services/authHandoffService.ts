/**
 * Session handoff to a clinic's own domain (demo feedback WS1).
 *
 * A clinic site on its own domain is a different browser *site* from the app,
 * so the refresh cookie a patient got when signing in on the app never reaches
 * it (SameSite=None + Partitioned in production, Lax locally — ADR 0005). The
 * booking page there would then ask a signed-in patient to sign in again.
 *
 * The handoff is a short top-level bounce through the app host:
 *
 *   clinic /book  → app /auth/handoff?return=<clinic url>
 *                 → POST /auth/handoff/start   (mints a code if signed in)
 *                 → clinic /book?handoff=<code>
 *                 → POST /auth/handoff/exchange (from the clinic origin)
 *                 → a fresh session whose refresh cookie lives in the
 *                   clinic site's partition.
 *
 * Guarantees: the return URL must be a live clinic site (the same check CORS
 * uses), so a code can only ever travel to a clinic domain; only the sha256 of
 * a code is stored; a code lives 60 s, works once, and only from the origin it
 * was minted for; only active PATIENT accounts can be handed off.
 */
import crypto from 'crypto'
import prisma from '../config/prisma'
import { isClinicSiteOrigin } from '../site/cors'
import { hashToken } from '../utils/tokenUtils'
import type { ApiError } from '../types/errors'

export const HANDOFF_TTL_MS = 60_000
/** Query parameter the code (or `none`) travels in on the way back. */
export const HANDOFF_PARAM = 'handoff'

const httpError = (message: string, statusCode: number, code: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

const isProduction = () => process.env.NODE_ENV === 'production'

/** Parses the return URL and checks it points at a live clinic site. */
export async function validateReturnUrl(raw: unknown): Promise<URL> {
  if (typeof raw !== 'string' || raw.length > 2048) {
    throw httpError('A return URL is required', 400, 'handoff_invalid_return')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw httpError('Invalid return URL', 400, 'handoff_invalid_return')
  }
  if (url.username || url.password || !(await isClinicSiteOrigin(url.origin, isProduction()))) {
    throw httpError('Return URL is not a clinic website', 400, 'handoff_invalid_return')
  }
  return url
}

/** `url` with the handoff parameter set to `value`. */
function withHandoffParam(url: URL, value: string): string {
  const next = new URL(url.toString())
  next.searchParams.set(HANDOFF_PARAM, value)
  return next.toString()
}

/**
 * Where to send the browser back to. A signed-in, active patient gets a fresh
 * one-time code; anyone else gets `handoff=none` (the clinic page then shows
 * its sign-in step). The return URL is validated either way, so this is never
 * an open redirect.
 */
export async function startHandoff(
  returnUrl: unknown,
  caller: { id: string; role: string } | undefined
): Promise<{ redirectUrl: string; handedOff: boolean }> {
  const url = await validateReturnUrl(returnUrl)
  if (!caller || caller.role !== 'PATIENT') {
    return { redirectUrl: withHandoffParam(url, 'none'), handedOff: false }
  }
  const user = await prisma.user.findUnique({
    where: { id: caller.id },
    select: { isActive: true, role: true },
  })
  if (!user?.isActive || user.role !== 'PATIENT') {
    return { redirectUrl: withHandoffParam(url, 'none'), handedOff: false }
  }

  const code = crypto.randomBytes(32).toString('base64url')
  await prisma.authHandoffCode.create({
    data: {
      userId: caller.id,
      codeHash: hashToken(code),
      origin: url.origin,
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    },
  })
  // Expired codes are useless; sweep this user's so the table stays small.
  await prisma.authHandoffCode.deleteMany({
    where: { userId: caller.id, expiresAt: { lt: new Date(Date.now() - HANDOFF_TTL_MS) } },
  })
  return { redirectUrl: withHandoffParam(url, code), handedOff: true }
}

/**
 * Consumes a code presented from `origin`. Atomic: of two concurrent
 * exchanges of the same code, exactly one wins. Every failure is the same
 * generic 401 so a caller learns nothing about why.
 */
export async function consumeHandoff(code: unknown, origin: string | undefined): Promise<string> {
  const invalid = () => httpError('Invalid or expired sign-in link', 401, 'handoff_invalid')
  if (typeof code !== 'string' || code.length < 20 || code.length > 128 || !origin) throw invalid()

  const row = await prisma.authHandoffCode.findUnique({
    where: { codeHash: hashToken(code) },
    select: { id: true, userId: true, origin: true, expiresAt: true, usedAt: true },
  })
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.origin !== origin) throw invalid()

  const claimed = await prisma.authHandoffCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count !== 1) throw invalid()

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { isActive: true, role: true },
  })
  if (!user?.isActive || user.role !== 'PATIENT') throw invalid()
  return row.userId
}

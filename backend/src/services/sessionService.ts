/**
 * Server-side sessions (B0.2.1 / B0.2.3).
 *
 * Every login creates a UserSession. Access tokens carry its id (`sid`) and
 * refresh tokens reference it, so:
 *  - logout revokes the session → the still-unexpired access token and the
 *    refresh token are both rejected on their next use (401);
 *  - idle timeout: a session with no authenticated request for
 *    SESSION_IDLE_TIMEOUT_MINUTES (default 15) is revoked server-side and the
 *    next request gets 401 `session_idle_timeout`. Refreshing a token does
 *    not count as activity, so a background refresh loop can't keep an
 *    abandoned workstation signed in;
 *  - refresh-token reuse revokes the session it belongs to.
 */
import prisma from '../config/prisma'
import { ApiError } from '../types/errors'

const DEFAULT_IDLE_MINUTES = 15
/** lastActivityAt is only rewritten when older than this (one write per minute per session). */
const TOUCH_INTERVAL_MS = 60_000
const SESSION_LIFETIME_DAYS = 7

export const getIdleTimeoutMs = (): number => {
  const minutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60_000
}

const sessionError = (message: string, code: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = 401
  err.code = code
  return err
}

export const createSession = async (params: {
  userId: string
  mfaVerified: boolean
  ipAddress?: string | null
  userAgent?: string | null
}) => {
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
  return prisma.userSession.create({
    data: {
      userId: params.userId,
      expiresAt,
      mfaVerifiedAt: params.mfaVerified ? new Date() : null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent?.slice(0, 300) ?? null,
    },
  })
}

export const revokeSession = async (sessionId: string, reason: string): Promise<void> => {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  await prisma.refreshToken.updateMany({
    where: { sessionId, revoked: false },
    data: { revoked: true },
  })
}

export const revokeAllSessions = async (
  userId: string,
  reason: string,
  exceptSessionId?: string
): Promise<void> => {
  await prisma.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revoked: false,
      ...(exceptSessionId ? { NOT: { sessionId: exceptSessionId } } : {}),
    },
    data: { revoked: true },
  })
}

/**
 * Validates the session behind an access token or refresh token. Throws a
 * 401 ApiError if it is missing, revoked, expired or idle (and revokes it in
 * the idle case). `touch` records activity — true for API requests, false
 * for token refresh.
 */
export const assertSessionActive = async (
  sessionId: string | undefined,
  userId: string,
  opts: { touch: boolean; now?: Date }
) => {
  if (!sessionId) throw sessionError('Session required — please sign in again', 'session_required')
  const now = opts.now ?? new Date()
  const session = await prisma.userSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    throw sessionError('Session not found — please sign in again', 'session_invalid')
  }
  if (session.revokedAt) {
    throw sessionError('Session has ended — please sign in again', 'session_revoked')
  }
  if (session.expiresAt <= now) {
    await revokeSession(session.id, 'expired')
    throw sessionError('Session expired — please sign in again', 'session_expired')
  }
  if (now.getTime() - session.lastActivityAt.getTime() > getIdleTimeoutMs()) {
    await revokeSession(session.id, 'idle_timeout')
    throw sessionError('Signed out after inactivity — please sign in again', 'session_idle_timeout')
  }
  if (opts.touch && now.getTime() - session.lastActivityAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastActivityAt: now } })
  }
  return session
}

import * as argon2 from 'argon2'
import type { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import * as authService from '../services/authService'
import * as passwordSetupService from '../services/passwordSetupService'
import * as sessionService from '../services/sessionService'
import * as mfaService from '../services/mfaService'
import * as breakGlassService from '../services/breakGlassService'
import { hashEmail, logAuthEvent, logAudit, requestMeta } from '../services/auditService'
import { recordFailedAuth } from '../services/securityMonitorService'
import {
  generateAccessToken,
  generateRefreshToken,
  generateMfaChallengeToken,
  verifyMfaChallengeToken,
  hashToken,
  getRefreshTokenExpiry,
} from '../utils/tokenUtils'
import type { ApiError } from '../types/errors'

const REFRESH_TOKEN_COOKIE = 'refreshToken'
const MIN_PASSWORD_LENGTH = 8

const setRefreshTokenCookie = (res: Response, token: string): void => {
  const isProduction = process.env.NODE_ENV === 'production'
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax', // Use lax for local dev to allow cross-port requests
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/', // Ensure it's sent for all requests
  })
}

const clearRefreshTokenCookie = (res: Response): void => {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
  })
}

const httpError = (message: string, statusCode: number, code?: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MB (OWASP recommended minimum)
    timeCost: 2,
    parallelism: 1,
  })

/**
 * Creates a session, sets the refresh cookie and returns the login payload
 * (same shape as GET /auth/me plus accessToken) so the client can route
 * immediately without a round-trip.
 */
const issueSessionAndRespond = async (
  req: Request,
  res: Response,
  userId: string,
  opts: { mfaVerified: boolean; message: string }
): Promise<void> => {
  const session = await sessionService.createSession({
    userId,
    mfaVerified: opts.mfaVerified,
    ...requestMeta(req),
  })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      clinicId: true,
      customRoleId: true,
      hasSeenTour: true,
      hasSeenPatientTour: true,
      tourCompletedAt: true,
      preferences: true,
      mfaEnabled: true,
      customRole: { select: { id: true, name: true, permissions: true } },
      clinic: {
        select: {
          id: true,
          name: true,
          tenant: {
            select: {
              id: true,
              name: true,
              onboardingCompletedAt: true,
              onboardingStep: true,
              termsAcceptedAt: true,
              termsVersion: true,
            },
          },
        },
      },
    },
  })
  if (!user) throw httpError('User not found', 401)

  const accessToken = generateAccessToken({
    userId: user.id,
    clinicId: user.clinicId,
    role: user.role,
    sid: session.id,
  })

  const refreshToken = generateRefreshToken()
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      token: hashToken(refreshToken),
      expiresAt: getRefreshTokenExpiry(),
    },
  })
  setRefreshTokenCookie(res, refreshToken)

  // Resolve effective permissions
  let permissions: string[] = []
  if (user.role === 'PLATFORM_ADMIN' || user.role === 'SUPER_ADMIN') {
    permissions = ['*']
  } else if (user.customRole?.permissions) {
    permissions = user.customRole.permissions as string[]
  }

  await logAuthEvent({
    action: opts.mfaVerified && user.mfaEnabled ? 'MFA_CHALLENGE_SUCCESS' : 'LOGIN_SUCCESS',
    userId: user.id,
    clinicId: user.clinicId,
    req,
    details: { sessionId: session.id },
  })

  successResponse(res, 200, opts.message, {
    accessToken,
    user: {
      ...user,
      customRoleName: user.customRole?.name ?? null,
      permissions,
    },
  })
}

const loginFailure = async (
  req: Request,
  params: { userId: string | null; clinicId: string | null; email: string; reason: string }
): Promise<void> => {
  recordFailedAuth(req.ip ?? null)
  await logAuthEvent({
    action: 'LOGIN_FAILURE',
    userId: params.userId,
    clinicId: params.clinicId,
    req,
    details: { reason: params.reason, emailHash: hashEmail(params.email) },
  })
}

export const register = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const user = await authService.registerUser(req.body as authService.RegisterBody)
    successResponse(res, 201, 'Registration successful', { user })
  }
)

export const login = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const {
      email,
      password,
      clinicId: clinicHint,
    } = req.body as {
      email: string
      password: string
      clinicId?: string | null
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      throw httpError('Email and password are required', 400)
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        clinicId: true,
        role: true,
        isActive: true,
        password: true,
        mfaEnabled: true,
      },
    })
    if (!user) {
      await loginFailure(req, { userId: null, clinicId: null, email, reason: 'unknown_email' })
      throw httpError('Invalid email or password', 401)
    }

    if (!user.isActive) {
      await loginFailure(req, {
        userId: user.id,
        clinicId: user.clinicId,
        email,
        reason: 'deactivated',
      })
      throw httpError('Account is deactivated', 403)
    }

    const passwordOk = await argon2.verify(user.password, password)
    if (!passwordOk) {
      await loginFailure(req, {
        userId: user.id,
        clinicId: user.clinicId,
        email,
        reason: 'bad_password',
      })
      throw httpError('Invalid email or password', 401)
    }

    // Cross-clinic login guard.
    //
    // When the request comes from a clinic-branded page (`/clinic/<slug>`),
    // the frontend forwards `clinicId` as a slug or cuid. We deliberately
    // surface the SAME generic 401 here ("Invalid email or password") so an
    // attacker can't enumerate which accounts belong to which clinic.
    //
    // PATIENT role is the only one this applies to — staff/SUPER_ADMIN sign
    // in from /dashboard, not a clinic page, and never carry a clinicId hint.
    if (clinicHint && user.role === 'PATIENT') {
      const targetClinic = await prisma.clinic.findFirst({
        where: { isActive: true, OR: [{ id: clinicHint }, { slug: clinicHint }] },
        select: { id: true },
      })
      if (targetClinic && user.clinicId !== targetClinic.id) {
        await loginFailure(req, {
          userId: user.id,
          clinicId: user.clinicId,
          email,
          reason: 'wrong_clinic',
        })
        throw httpError('Invalid email or password', 401)
      }
    }

    // MFA-enrolled users get a challenge, not tokens (B0.2.2).
    if (user.mfaEnabled) {
      successResponse(res, 200, 'Multi-factor verification required', {
        mfaRequired: true,
        mfaToken: generateMfaChallengeToken(user.id),
      })
      return
    }

    await issueSessionAndRespond(req, res, user.id, {
      mfaVerified: false,
      message: 'Login successful',
    })
  }
)

/** POST /auth/mfa/verify — second step of an MFA login. */
export const verifyMfaLogin = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { mfaToken, code, recoveryCode } = req.body as {
    mfaToken?: string
    code?: string
    recoveryCode?: string
  }
  if (!mfaToken || (!code && !recoveryCode)) {
    throw httpError('mfaToken and a code or recoveryCode are required', 400)
  }
  let userId: string
  try {
    userId = verifyMfaChallengeToken(mfaToken).userId
  } catch {
    throw httpError('MFA challenge expired — sign in again', 401, 'mfa_challenge_invalid')
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, clinicId: true, isActive: true },
  })
  if (!user?.isActive) throw httpError('Account is deactivated', 403)

  const factor = await mfaService.verifySecondFactor(userId, { code, recoveryCode })
  if (!factor) {
    recordFailedAuth(req.ip ?? null)
    await logAuthEvent({ action: 'MFA_CHALLENGE_FAILURE', userId, clinicId: user.clinicId, req })
    throw httpError('Invalid verification code', 401, 'mfa_invalid_code')
  }
  if (factor === 'recovery_code') {
    await logAuthEvent({
      action: 'MFA_RECOVERY_CODE_USED',
      userId,
      clinicId: user.clinicId,
      req,
      severity: 'warning',
    })
  }
  await issueSessionAndRespond(req, res, userId, { mfaVerified: true, message: 'Login successful' })
})

export const markPatientTourSeen = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!req.user) throw httpError('Authentication required', 401)
    await prisma.user.update({
      where: { id: req.user.id },
      data: { hasSeenPatientTour: true },
    })
    successResponse(res, 200, 'Tour marked as seen')
  }
)

export const refreshToken = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined

    if (!token) throw httpError('Refresh token required', 401)

    const storedToken = await prisma.refreshToken.findFirst({
      where: { token: hashToken(token) },
      include: { user: true },
    })

    if (!storedToken) throw httpError('Invalid refresh token', 401)

    if (storedToken.revoked) {
      // Token reuse detected — this indicates a stolen token.
      // Revoke ALL sessions + refresh tokens for this user (nuclear option).
      await sessionService.revokeAllSessions(storedToken.userId, 'refresh_token_reuse')
      await logAuthEvent({
        action: 'REFRESH_TOKEN_REUSE',
        userId: storedToken.userId,
        clinicId: storedToken.user.clinicId,
        req,
        severity: 'critical',
      })
      clearRefreshTokenCookie(res)
      throw httpError(
        'Security alert: refresh token reuse detected. All sessions revoked. Please log in again.',
        401
      )
    }

    if (new Date() > storedToken.expiresAt) {
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      })
      throw httpError('Refresh token expired', 401)
    }

    if (!storedToken.user.isActive) throw httpError('Account is deactivated', 403)

    // The session must still be live (not logged out, not idle). Refreshing
    // does not count as activity.
    let session
    try {
      session = await sessionService.assertSessionActive(
        storedToken.sessionId ?? undefined,
        storedToken.userId,
        { touch: false }
      )
    } catch (err) {
      clearRefreshTokenCookie(res)
      if ((err as ApiError).code === 'session_idle_timeout') {
        await logAuthEvent({
          action: 'SESSION_IDLE_TIMEOUT',
          userId: storedToken.userId,
          clinicId: storedToken.user.clinicId,
          req,
        })
      }
      throw err
    }

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    })

    const newRefreshToken = generateRefreshToken()
    await prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        sessionId: session.id,
        token: hashToken(newRefreshToken),
        expiresAt: getRefreshTokenExpiry(),
      },
    })

    setRefreshTokenCookie(res, newRefreshToken)

    const accessToken = generateAccessToken({
      userId: storedToken.user.id,
      clinicId: storedToken.user.clinicId,
      role: storedToken.user.role,
      sid: session.id,
    })

    successResponse(res, 200, 'Token refreshed', { accessToken })
  }
)

/**
 * Ends the session behind the refresh cookie (and, if presented, the access
 * token's session). Both tokens are rejected afterwards.
 */
export const logout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined
    const sessionIds = new Set<string>()
    let userId: string | null = null
    let clinicId: string | null = null

    if (token) {
      const stored = await prisma.refreshToken.findFirst({
        where: { token: hashToken(token) },
        select: { id: true, sessionId: true, userId: true, user: { select: { clinicId: true } } },
      })
      if (stored) {
        await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } })
        if (stored.sessionId) sessionIds.add(stored.sessionId)
        userId = stored.userId
        clinicId = stored.user.clinicId
      }
    }

    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyAccessToken } = await import('../utils/tokenUtils')
        const decoded = verifyAccessToken(authHeader.split(' ')[1]!)
        if (decoded.sid) sessionIds.add(decoded.sid)
        userId ??= decoded.userId
        clinicId ??= decoded.clinicId ?? null
      } catch {
        // An expired/invalid access token is fine at logout.
      }
    }

    for (const sid of sessionIds) await sessionService.revokeSession(sid, 'logout')
    if (userId) await logAuthEvent({ action: 'LOGOUT', userId, clinicId, req })

    clearRefreshTokenCookie(res)
    successResponse(res, 200, 'Logged out successfully')
  }
)

export const me = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!req.user?.id) throw httpError('Not authenticated', 401)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clinicId: true,
        customRoleId: true,
        customRole: { select: { id: true, name: true, permissions: true } },
        permissions: true,
        hasSeenTour: true,
        tourCompletedAt: true,
        preferences: true,
        mfaEnabled: true,
        clinic: {
          select: {
            id: true,
            name: true,
            tenant: {
              select: {
                id: true,
                name: true,
                onboardingCompletedAt: true,
                onboardingStep: true,
                termsAcceptedAt: true,
                termsVersion: true,
              },
            },
          },
        },
      },
    })
    successResponse(res, 200, 'User retrieved', {
      user: { ...user, breakGlass: req.breakGlass ?? null },
    })
  }
)

const ALLOWED_UPDATE_KEYS = new Set(['name', 'hasSeenTour', 'preferences'])

export const updateMe = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    if (!req.user?.id) throw httpError('Not authenticated', 401)

    const body = (req.body ?? {}) as Record<string, unknown>
    const updates: {
      name?: string
      hasSeenTour?: boolean
      tourCompletedAt?: Date | null
      preferences?: object
    } = {}

    for (const key of Object.keys(body)) {
      if (!ALLOWED_UPDATE_KEYS.has(key)) throw httpError(`Unknown field: ${key}`, 400)
    }

    if (typeof body['name'] === 'string') {
      const trimmed = body['name'].trim()
      if (trimmed.length < 2 || trimmed.length > 100) {
        throw httpError('Name must be 2–100 characters', 400)
      }
      updates.name = trimmed
    }

    if (typeof body['hasSeenTour'] === 'boolean') {
      updates.hasSeenTour = body['hasSeenTour']
      updates.tourCompletedAt = body['hasSeenTour'] ? new Date() : null
    }

    if (body['preferences'] !== undefined) {
      if (typeof body['preferences'] !== 'object' || Array.isArray(body['preferences'])) {
        throw httpError('preferences must be an object', 400)
      }
      updates.preferences = body['preferences'] as object
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: updates as never,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clinicId: true,
        hasSeenTour: true,
        tourCompletedAt: true,
        preferences: true,
        customRoleId: true,
        customRole: { select: { id: true, name: true, permissions: true } },
        permissions: true,
      },
    })

    successResponse(res, 200, 'User updated', { user: updated })
  }
)

export const setPassword = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { token, password, confirmPassword } = req.body as {
      token: string
      password: string
      confirmPassword: string
    }

    if (!password || password !== confirmPassword) throw httpError('Passwords do not match', 400)

    const { userId, email } = await passwordSetupService.redeemPasswordSetupToken(token, password)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { clinicId: true } })
    await sessionService.revokeAllSessions(userId, 'password_set')
    await logAuthEvent({ action: 'PASSWORD_SET', userId, clinicId: user?.clinicId ?? null, req })

    successResponse(res, 200, 'Password set successfully. You can now log in.', {
      userId,
      email,
    })
  }
)

/** POST /auth/change-password — signed-in password change; signs out other sessions. */
export const changePassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw httpError('Authentication required', 401)
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string
    newPassword?: string
  }
  if (!currentPassword || !newPassword) {
    throw httpError('currentPassword and newPassword are required', 400)
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 128) {
    throw httpError(`Password must be ${MIN_PASSWORD_LENGTH}–128 characters`, 400)
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { password: true },
  })
  if (!user || !(await argon2.verify(user.password, currentPassword))) {
    recordFailedAuth(req.ip ?? null)
    throw httpError('Current password is incorrect', 401)
  }
  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: await hashPassword(newPassword), passwordChangedAt: new Date() },
  })
  await sessionService.revokeAllSessions(req.user.id, 'password_changed', req.user.sessionId)
  await logAuthEvent({
    action: 'PASSWORD_CHANGED',
    userId: req.user.id,
    clinicId: req.user.clinicId,
    req,
  })
  successResponse(res, 200, 'Password changed. Other sessions have been signed out.')
})

// ─── MFA enrolment (B0.2.2) ──────────────────────────────────────────────────

export const mfaSetup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const result = await mfaService.beginEnrollment(req.user!.id)
  successResponse(res, 200, 'Scan the QR code / enter the secret in your authenticator app', result)
})

export const mfaEnable = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body as { code?: string }
  if (!code) throw httpError('code is required', 400)
  const { recoveryCodes } = await mfaService.confirmEnrollment(req.user!.id, code)
  // The enrolling session has just proven possession of the factor; every
  // other session must sign in again with MFA.
  if (req.user!.sessionId) {
    await prisma.userSession.update({
      where: { id: req.user!.sessionId },
      data: { mfaVerifiedAt: new Date() },
    })
  }
  await sessionService.revokeAllSessions(req.user!.id, 'mfa_enabled', req.user!.sessionId)
  await logAuthEvent({
    action: 'MFA_ENABLED',
    userId: req.user!.id,
    clinicId: req.user!.clinicId,
    req,
  })
  successResponse(
    res,
    200,
    'MFA enabled. Store these recovery codes somewhere safe — they are shown once.',
    {
      recoveryCodes,
    }
  )
})

export const mfaDisable = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { code, recoveryCode } = req.body as { code?: string; recoveryCode?: string }
  if (!code && !recoveryCode) throw httpError('code or recoveryCode is required', 400)
  await mfaService.disableMfa(req.user!.id, { code, recoveryCode })
  await logAuthEvent({
    action: 'MFA_DISABLED',
    userId: req.user!.id,
    clinicId: req.user!.clinicId,
    req,
    severity: 'warning',
  })
  successResponse(res, 200, 'MFA disabled')
})

// ─── Break-glass (B0.2.6) ────────────────────────────────────────────────────

export const breakGlassActivate = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { reason, durationMinutes, patientId } = req.body as {
      reason?: string
      durationMinutes?: number
      patientId?: string
    }
    const grant = await breakGlassService.activateBreakGlass(req, {
      reason: reason ?? '',
      durationMinutes,
      patientId,
    })
    successResponse(res, 201, 'Emergency access granted. Every action is being audited.', {
      grant: { id: grant.id, expiresAt: grant.expiresAt, patientId: grant.patientId },
    })
  }
)

export const breakGlassStatus = (req: Request, res: Response): void => {
  successResponse(res, 200, 'Break-glass status', { grant: req.breakGlass ?? null })
}

export const breakGlassEnd = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const grant = await breakGlassService.endBreakGlass(req)
  successResponse(res, 200, grant ? 'Emergency access ended' : 'No active emergency access', {
    ended: Boolean(grant),
  })
})

/** Used by staff/role controllers when permissions change (B0.3.4). */
export const auditPermissionChange = (
  req: Request,
  params: {
    clinicId: string
    entityType: 'User' | 'CustomRole'
    entityId: string
    oldValue: unknown
    newValue: unknown
  }
) =>
  logAudit({
    clinicId: params.clinicId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: 'PERMISSION_CHANGED',
    oldValue: params.oldValue,
    newValue: params.newValue,
    performedById: req.user!.id,
    severity: 'warning',
    ...requestMeta(req),
  })

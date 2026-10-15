/**
 * TOTP multi-factor authentication for staff (B0.2.2).
 *
 * Flow:
 *   POST /auth/mfa/setup    → secret + otpauth URL (pending until confirmed)
 *   POST /auth/mfa/enable   → confirm with a code; returns 10 one-time recovery codes
 *   POST /auth/login        → for an enrolled user returns { mfaRequired, mfaToken }, no tokens
 *   POST /auth/mfa/verify   → mfaToken + code (or recovery code) → session + tokens
 *   POST /auth/mfa/disable  → requires a current code or recovery code
 *
 * Secrets are AES-256-GCM encrypted (MFA_ENCRYPTION_KEY); recovery codes are
 * stored as sha256 hashes and are single-use; a TOTP step can't be replayed.
 */
import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../utils/totp'
import { openSecret, sealSecret } from '../utils/secretBox'

const RECOVERY_CODE_COUNT = 10

/** Roles that may enrol. Patients use the portal without MFA for now. */
export const MFA_ELIGIBLE_ROLES = new Set([
  'SUPER_ADMIN',
  'PROVIDER',
  'FRONT_DESK',
  'ACCOUNTING',
  'MARKETING',
  'STAFF',
  'PLATFORM_ADMIN',
])

const fail = (message: string, status = 400, code?: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = status
  if (code) err.code = code
  return err
}

const hashRecoveryCode = (code: string): string =>
  crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex')

const newRecoveryCode = (): string => {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

export const beginEnrollment = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, mfaEnabled: true },
  })
  if (!user) throw fail('User not found', 404)
  if (!MFA_ELIGIBLE_ROLES.has(user.role))
    throw fail('MFA enrolment is available to staff accounts', 403)
  if (user.mfaEnabled) throw fail('MFA is already enabled', 409, 'mfa_already_enabled')

  const secret = generateTotpSecret()
  await prisma.user.update({
    where: { id: userId },
    data: { mfaPendingSecret: sealSecret(secret) },
  })
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) }
}

export const confirmEnrollment = async (userId: string, code: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaPendingSecret: true, mfaEnabled: true },
  })
  if (!user) throw fail('User not found', 404)
  if (user.mfaEnabled) throw fail('MFA is already enabled', 409, 'mfa_already_enabled')
  if (!user.mfaPendingSecret) throw fail('Start MFA setup first', 400, 'mfa_setup_required')

  const secret = openSecret(user.mfaPendingSecret)
  const step = verifyTotp(secret, code)
  if (step === null) throw fail('Invalid verification code', 400, 'mfa_invalid_code')

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecret: sealSecret(secret),
      mfaPendingSecret: null,
      mfaEnrolledAt: new Date(),
      mfaLastUsedStep: step,
      mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) as Prisma.InputJsonValue,
    },
  })
  return { recoveryCodes }
}

/**
 * Verifies a TOTP code or a recovery code for an enrolled user. Consumes the
 * recovery code / records the TOTP step on success. Returns which factor was
 * used, or null when neither matches.
 */
export const verifySecondFactor = async (
  userId: string,
  input: { code?: string; recoveryCode?: string },
  nowMs = Date.now()
): Promise<'totp' | 'recovery_code' | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaLastUsedStep: true, mfaRecoveryCodes: true },
  })
  if (!user?.mfaEnabled || !user.mfaSecret) return null

  if (input.code) {
    const step = verifyTotp(openSecret(user.mfaSecret), input.code, nowMs)
    if (step === null) return null
    if (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep) return null // replay
    // Conditional write so two concurrent uses of one code can't both pass.
    const updated = await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    })
    return updated.count === 1 ? 'totp' : null
  }

  if (input.recoveryCode) {
    const hashes = Array.isArray(user.mfaRecoveryCodes) ? (user.mfaRecoveryCodes as string[]) : []
    const hash = hashRecoveryCode(input.recoveryCode)
    if (!hashes.includes(hash)) return null
    await prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: hashes.filter((h) => h !== hash) as Prisma.InputJsonValue },
    })
    return 'recovery_code'
  }
  return null
}

export const disableMfa = async (
  userId: string,
  input: { code?: string; recoveryCode?: string }
) => {
  const factor = await verifySecondFactor(userId, input)
  if (!factor) throw fail('Invalid verification code', 400, 'mfa_invalid_code')
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnrolledAt: null,
      mfaLastUsedStep: null,
      mfaRecoveryCodes: [] as Prisma.InputJsonValue,
    },
  })
  return factor
}

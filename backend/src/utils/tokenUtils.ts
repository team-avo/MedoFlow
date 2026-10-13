import crypto from 'crypto'
import jwt from 'jsonwebtoken'

const ACCESS_TOKEN_EXPIRY = '15m'
const MFA_CHALLENGE_EXPIRY = '5m'
const REFRESH_TOKEN_EXPIRY_DAYS = 7

export interface TokenPayload {
  userId: string
  clinicId?: string | null
  role: string
  /** UserSession id — every access token is bound to a server-side session. */
  sid: string
}

const PLACEHOLDER_PATTERN = /change[-_ ]?me|secret|password|example|placeholder|changeme/i
export const MIN_JWT_SECRET_LENGTH = 32
export const MIN_JWT_SECRET_BITS = 128

/**
 * B0.2.1: reject weak signing secrets. Length ≥ 32, no placeholder words,
 * and an estimated entropy (length × log2(distinct characters)) ≥ 128 bits.
 * `openssl rand -hex 32` gives 64 chars × 4 bits = 256 bits.
 * Returns the reason the secret is weak, or null when it is acceptable.
 */
export const jwtSecretWeakness = (secret: string | undefined): string | null => {
  if (!secret) return 'is not set'
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `is shorter than ${MIN_JWT_SECRET_LENGTH} characters`
  }
  if (PLACEHOLDER_PATTERN.test(secret)) return 'looks like a placeholder value'
  const distinct = new Set(secret).size
  const bits = secret.length * Math.log2(Math.max(distinct, 1))
  if (bits < MIN_JWT_SECRET_BITS) {
    return `has too little entropy (~${Math.floor(bits)} bits, need ${MIN_JWT_SECRET_BITS})`
  }
  return null
}

/**
 * Secrets accepted for verification: the current one first, then
 * JWT_SECRET_PREVIOUS during a rotation window (B0.6.3). Tokens are always
 * signed with the current secret.
 */
const verificationSecrets = (): string[] =>
  [process.env.JWT_SECRET, process.env.JWT_SECRET_PREVIOUS].filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  )

const verifyWithRotation = <T>(token: string): T => {
  let lastError: unknown
  for (const secret of verificationSecrets()) {
    try {
      return jwt.verify(token, secret, { algorithms: ['HS256'] }) as T
    } catch (err) {
      lastError = err
      // An expired token is expired under every secret; don't mask it.
      if ((err as Error).name === 'TokenExpiredError') throw err
    }
  }
  throw lastError ?? new jwt.JsonWebTokenError('invalid signature')
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(
    { userId: payload.userId, clinicId: payload.clinicId, role: payload.role, sid: payload.sid },
    process.env.JWT_SECRET as string,
    { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' }
  )
}

export const verifyAccessToken = (token: string): TokenPayload => {
  const decoded = verifyWithRotation<TokenPayload & { purpose?: string }>(token)
  if (decoded.purpose) throw new jwt.JsonWebTokenError('wrong token type')
  return decoded
}

/** Short-lived token proving the password step passed; exchanged at /auth/mfa/verify. */
export const generateMfaChallengeToken = (userId: string): string => {
  return jwt.sign({ userId, purpose: 'mfa' }, process.env.JWT_SECRET as string, {
    expiresIn: MFA_CHALLENGE_EXPIRY,
    algorithm: 'HS256',
  })
}

export const verifyMfaChallengeToken = (token: string): { userId: string } => {
  const decoded = verifyWithRotation<{ userId: string; purpose?: string }>(token)
  if (decoded.purpose !== 'mfa') throw new jwt.JsonWebTokenError('wrong token type')
  return { userId: decoded.userId }
}

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString('hex')
}

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export const getRefreshTokenExpiry = (): Date => {
  const date = new Date()
  date.setDate(date.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)
  return date
}

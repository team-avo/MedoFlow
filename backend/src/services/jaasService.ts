/**
 * Jitsi as a Service (JaaS / 8x8.vc): JWT-signed room tokens.
 *
 * Every participant joins with a short-lived token the backend signs with the
 * clinic's JaaS private key: the provider as moderator, the patient as a plain
 * participant, so neither sees an 8x8 log-in prompt.
 *
 * Minimum necessary (HIPAA): the token carries an opaque user id and a short
 * display name only: never an email, and turns off every 8x8 feature that
 * would store the call on 8x8's side (recording, livestreaming, transcription).
 * The AI scribe records the provider's microphone locally instead.
 *
 * Required env vars:
 *   JAAS_APP_ID       e.g. "vpaas-magic-cookie-abcd1234..."
 *   JAAS_KID          API Key ID from the JaaS console ("<appId>/<id>")
 *   JAAS_PRIVATE_KEY  PEM-encoded RSA private key, raw or with escaped `\n`
 *                     sequences: or JAAS_PRIVATE_KEY_PATH, a path to the PEM.
 *   VIDEO_PHI_POLICY  production only: "baa-signed" once 8x8's BAA is signed,
 *                     or "synthetic-data-only" for test environments.
 *
 * Without the JaaS values video calls are disabled: the endpoints answer 503
 * `video_not_configured` and the UI says so.
 */

import jwt from 'jsonwebtoken'
import { createPrivateKey, randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { ApiError } from '../types/errors'

export const JAAS_DOMAIN = '8x8.vc'

/** Token lifetime: long enough for a consult, re-minted on every fetch. */
export const JAAS_TOKEN_TTL_MINUTES = 90

export const VIDEO_PHI_POLICIES = ['baa-signed', 'synthetic-data-only'] as const

export interface JaasConfig {
  appId: string
  kid: string
  privateKey: string
}

export interface JaasTokenOptions {
  roomName: string
  user: {
    /** Opaque internal id: never an email or a name. */
    id: string
    /** What the other participant sees, e.g. "Dr. Chen" or "Anika". */
    name: string
    moderator?: boolean
  }
  /** Token lifetime in minutes. Defaults to JAAS_TOKEN_TTL_MINUTES. */
  expiresInMinutes?: number
}

export interface VideoRoomResult {
  /** Jitsi iframe domain: always "8x8.vc". */
  domain: string
  /** The room path Jitsi expects: "<appId>/<room>". */
  roomName: string
  /** Direct browser URL to the room (informational). */
  roomUrl: string
  /** JWT for this user + room. */
  jwt: string
}

/** Cached PEM so we don't re-read the key file on every request. */
let cachedPrivateKey: string | null = null
let cachedPrivateKeySource: string | null = null

function readPrivateKey(env: NodeJS.ProcessEnv): string | null {
  const inlineKey = env.JAAS_PRIVATE_KEY
  if (inlineKey) return inlineKey.includes('\\n') ? inlineKey.replace(/\\n/g, '\n') : inlineKey

  const keyPath = env.JAAS_PRIVATE_KEY_PATH
  if (!keyPath) return null
  // Relative paths resolve against the backend working directory, so
  // `./secrets/jaas-private.pem` works however the process was started.
  const absPath = resolve(process.cwd(), keyPath)
  if (cachedPrivateKey && cachedPrivateKeySource === absPath) return cachedPrivateKey
  try {
    cachedPrivateKey = readFileSync(absPath, 'utf8')
    cachedPrivateKeySource = absPath
    return cachedPrivateKey
  } catch {
    return null
  }
}

/** JaaS settings from env, or null when any required value is missing. */
export function getJaasConfig(env: NodeJS.ProcessEnv = process.env): JaasConfig | null {
  const appId = env.JAAS_APP_ID?.trim()
  const kid = env.JAAS_KID?.trim()
  if (!appId || !kid) return null
  const privateKey = readPrivateKey(env)
  if (!privateKey) return null
  return { appId, kid, privateKey }
}

/** True when the backend has everything needed to mint JaaS tokens. */
export function isJaasEnabled(): boolean {
  return getJaasConfig() !== null
}

/** The error the video endpoints answer with when JaaS is not set up. */
export function videoNotConfiguredError(): ApiError {
  const err = new Error('Video calls are not set up on this server') as ApiError
  err.statusCode = 503
  err.code = 'video_not_configured'
  return err
}

function requireConfig(): JaasConfig {
  const config = getJaasConfig()
  if (!config) throw videoNotConfiguredError()
  return config
}

/**
 * Boot-time checks (envValidation). `fatal` stops a production boot; outside
 * production it is printed as a warning. Messages name variables, never values.
 */
export function videoConfigProblems(
  env: NodeJS.ProcessEnv = process.env
): { fatal: boolean; message: string }[] {
  const names = ['JAAS_APP_ID', 'JAAS_KID', 'JAAS_PRIVATE_KEY', 'JAAS_PRIVATE_KEY_PATH']
  const anySet = names.some((n) => env[n]?.trim())
  if (!anySet) {
    return [{ fatal: false, message: 'JAAS_* is not set: video consultations are disabled' }]
  }

  const problems: { fatal: boolean; message: string }[] = []
  if (!env.JAAS_APP_ID?.trim()) problems.push({ fatal: true, message: 'JAAS_APP_ID is not set' })
  if (!env.JAAS_KID?.trim()) problems.push({ fatal: true, message: 'JAAS_KID is not set' })
  const key = readPrivateKey(env)
  if (!key) {
    problems.push({
      fatal: true,
      message: env.JAAS_PRIVATE_KEY_PATH
        ? 'JAAS_PRIVATE_KEY_PATH cannot be read'
        : 'JAAS_PRIVATE_KEY (or JAAS_PRIVATE_KEY_PATH) is not set',
    })
  } else {
    try {
      createPrivateKey(key)
    } catch {
      problems.push({
        fatal: true,
        message: 'The JaaS private key is not a valid PEM private key (check the \\n escapes)',
      })
    }
  }

  if (env.NODE_ENV === 'production') {
    const policy = env.VIDEO_PHI_POLICY?.trim()
    if (!policy || !(VIDEO_PHI_POLICIES as readonly string[]).includes(policy)) {
      problems.push({
        fatal: true,
        message:
          'VIDEO_PHI_POLICY must be "baa-signed" (8x8 BAA signed) or "synthetic-data-only"; video calls carry PHI to 8x8',
      })
    }
  }
  return problems
}

/** A new, unique room path under the JaaS app: "<appId>/<prefix>-<nonce>". */
export function generateRoomName(prefix = 'MedoFlow'): string {
  const config = requireConfig()
  return `${config.appId}/${prefix}-${randomBytes(4).toString('hex')}`
}

/** True when a stored room name belongs to the configured JaaS app. */
export function isOwnRoom(roomName: string | null | undefined): boolean {
  const config = getJaasConfig()
  return !!config && !!roomName && roomName.startsWith(`${config.appId}/`)
}

/** Sign a per-user JaaS JWT for one room. */
export function signJaasToken(options: JaasTokenOptions): string {
  const config = requireConfig()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (options.expiresInMinutes ?? JAAS_TOKEN_TTL_MINUTES) * 60

  // JaaS' `room` claim is the suffix after "<appId>/".
  const roomClaim = options.roomName.startsWith(`${config.appId}/`)
    ? options.roomName.slice(config.appId.length + 1)
    : options.roomName

  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: config.appId,
    room: roomClaim,
    nbf: now - 10,
    exp,
    context: {
      user: {
        id: options.user.id,
        name: options.user.name,
        moderator: options.user.moderator ? 'true' : 'false',
      },
      // Nothing about the call is stored or relayed by 8x8.
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'false',
        'outbound-call': 'false',
        'sip-outbound-call': 'false',
      },
    },
  }

  return jwt.sign(payload, config.privateKey, {
    algorithm: 'RS256',
    header: { alg: 'RS256', kid: config.kid, typ: 'JWT' },
  })
}

/** `{ domain, roomName, roomUrl, jwt }` for one user in one room. */
export function buildVideoRoom(options: {
  roomName: string
  user: JaasTokenOptions['user']
}): VideoRoomResult {
  requireConfig()
  return {
    domain: JAAS_DOMAIN,
    roomName: options.roomName,
    roomUrl: `https://${JAAS_DOMAIN}/${options.roomName}`,
    jwt: signJaasToken({ roomName: options.roomName, user: options.user }),
  }
}

/** Display names in the call: the provider's title + surname, the patient's first name. */
export function providerDisplayName(p: { lastName?: string | null } | null | undefined): string {
  return p?.lastName ? `Dr. ${p.lastName}` : 'Provider'
}

export function patientDisplayName(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0]
  return first || 'Patient'
}

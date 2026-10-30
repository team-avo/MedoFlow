/**
 * Google access tokens for Gemini on Vertex AI (auth style 'google-adc').
 *
 * Vertex's OpenAI-compatible endpoint takes a short-lived OAuth access token
 * as the bearer, not an API key. Sources, in order:
 *   1. a service-account key: GOOGLE_APPLICATION_CREDENTIALS (file path) or
 *      GOOGLE_APPLICATION_CREDENTIALS_JSON (inline) — signed JWT exchanged at
 *      the key's token_uri (RFC 7523);
 *   2. the GCP metadata server (Cloud Run, GKE, GCE).
 * Tokens are cached until a minute before they expire. No SDK dependency.
 */
import crypto from 'crypto'
import fs from 'fs'
import { AiError } from './errors'

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

let cached: { token: string; expiresAt: number } | null = null

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

function readServiceAccount(env: NodeJS.ProcessEnv): ServiceAccountKey | null {
  const inline = env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()
  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  const raw = inline || (file ? fs.readFileSync(file, 'utf8') : '')
  if (!raw) return null
  const key = JSON.parse(raw) as Partial<ServiceAccountKey>
  if (!key.client_email || !key.private_key) throw new AiError('ai_auth')
  return key as ServiceAccountKey
}

async function exchangeServiceAccount(
  key: ServiceAccountKey,
  fetchImpl: typeof fetch
): Promise<{ token: string; expiresIn: number }> {
  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })
  )
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(key.private_key)
  const assertion = `${header}.${claims}.${b64url(signature)}`
  const res = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new AiError('ai_auth', res.status)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new AiError('ai_auth')
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 }
}

async function fromMetadataServer(
  fetchImpl: typeof fetch
): Promise<{ token: string; expiresIn: number }> {
  const res = await fetchImpl(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new AiError('ai_auth', res.status)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new AiError('ai_auth')
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 }
}

/** A valid access token for Vertex AI. Throws AiError('ai_auth') when none can be obtained. */
export async function getGoogleAccessToken(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token
  let result: { token: string; expiresIn: number }
  try {
    const key = readServiceAccount(env)
    result = key
      ? await exchangeServiceAccount(key, fetchImpl)
      : await fromMetadataServer(fetchImpl)
  } catch (e) {
    throw e instanceof AiError ? e : new AiError('ai_auth')
  }
  cached = { token: result.token, expiresAt: Date.now() + (result.expiresIn - 60) * 1000 }
  return result.token
}

/** Tests only. */
export function resetGoogleTokenCache(): void {
  cached = null
}

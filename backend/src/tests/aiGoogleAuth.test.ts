/**
 * Vertex AI access tokens (auth style 'google-adc') — the BAA-eligible path
 * for Gemini. Service-account JWT exchange (RFC 7523), metadata-server
 * fallback, caching, and failures as ai_auth.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getGoogleAccessToken, resetGoogleTokenCache } from '../services/ai/googleAuth'
import { AiError } from '../services/ai/errors'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const serviceAccount = {
  client_email: 'scribe@synthetic-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.example.test/token',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => resetGoogleTokenCache())

it('exchanges a signed service-account JWT for an access token, then caches it', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(
      jsonResponse({ access_token: 'synthetic-access-token', expires_in: 3600 })
    )
  }) as unknown as typeof fetch
  const env = { GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify(serviceAccount) }

  assert.equal(await getGoogleAccessToken(env, fetchImpl), 'synthetic-access-token')
  assert.equal(await getGoogleAccessToken(env, fetchImpl), 'synthetic-access-token')
  assert.equal(calls.length, 1, 'the second call is served from the cache')

  const [{ url, init }] = calls as [{ url: string; init: RequestInit }]
  assert.equal(url, serviceAccount.token_uri)
  const form = new URLSearchParams(init.body as string)
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const [header, claims, signature] = form.get('assertion')!.split('.') as [string, string, string]
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'RS256',
    typ: 'JWT',
  })
  const c = JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>
  assert.equal(c.iss, serviceAccount.client_email)
  assert.equal(c.aud, serviceAccount.token_uri)
  assert.equal(c.scope, 'https://www.googleapis.com/auth/cloud-platform')
  const verified = crypto
    .createVerify('RSA-SHA256')
    .update(`${header}.${claims}`)
    .verify(publicKey, Buffer.from(signature, 'base64url'))
  assert.equal(verified, true, 'the JWT is signed with the service-account key')
})

it('falls back to the GCP metadata server', async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seen = { url, headers: init?.headers as Record<string, string> }
    return Promise.resolve(jsonResponse({ access_token: 'meta-token', expires_in: 1200 }))
  }) as unknown as typeof fetch
  assert.equal(await getGoogleAccessToken({}, fetchImpl), 'meta-token')
  assert.match(seen!.url, /^http:\/\/metadata\.google\.internal\/.*\/token$/)
  assert.equal(seen!.headers['Metadata-Flavor'], 'Google')
})

it('a refused exchange, a bad key or no metadata server is ai_auth', async () => {
  const refused = (() =>
    Promise.resolve(jsonResponse({ error: 'invalid_grant' }, 400))) as unknown as typeof fetch
  const isAuth = (e: unknown) => e instanceof AiError && e.code === 'ai_auth' && !e.retryable
  await assert.rejects(
    getGoogleAccessToken(
      { GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify(serviceAccount) },
      refused
    ),
    isAuth
  )
  await assert.rejects(
    getGoogleAccessToken({ GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"client_email":"x"}' }, refused),
    isAuth
  )
  const offline = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
  await assert.rejects(getGoogleAccessToken({}, offline), isAuth)
})

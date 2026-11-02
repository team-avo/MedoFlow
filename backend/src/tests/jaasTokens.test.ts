/**
 * Video consultations (8x8 JaaS): the call token and the boot checks.
 * Tokens carry no email, turn every 8x8 recording/streaming feature off and
 * expire after 90 minutes; without config the API answers 503
 * video_not_configured; production needs a BAA decision (VIDEO_PHI_POLICY).
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'crypto'
import jwt from 'jsonwebtoken'
import {
  JAAS_TOKEN_TTL_MINUTES,
  buildVideoRoom,
  generateRoomName,
  isOwnRoom,
  patientDisplayName,
  providerDisplayName,
  signJaasToken,
  videoConfigProblems,
} from '../services/jaasService'
import { collectEnvProblems } from '../config/envValidation'

const APP_ID = 'vpaas-magic-cookie-test0001'
const KID = `${APP_ID}/abc123`
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
// How the key is pasted into Render: one line, newlines written as \n.
const ESCAPED_KEY = privateKey.replace(/\n/g, '\\n')

const JAAS_VARS = ['JAAS_APP_ID', 'JAAS_KID', 'JAAS_PRIVATE_KEY', 'JAAS_PRIVATE_KEY_PATH']
const saved: Record<string, string | undefined> = {}

function configure(vars: Record<string, string | undefined>) {
  for (const name of JAAS_VARS) delete process.env[name]
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v
}

beforeAll(() => {
  for (const name of JAAS_VARS) saved[name] = process.env[name]
})
afterAll(() => configure(saved))
beforeEach(() => configure({ JAAS_APP_ID: APP_ID, JAAS_KID: KID, JAAS_PRIVATE_KEY: ESCAPED_KEY }))

type Claims = {
  aud: string
  iss: string
  sub: string
  room: string
  nbf: number
  exp: number
  context: {
    user: Record<string, string>
    features: Record<string, string>
  }
}
const verify = (token: string) =>
  jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as unknown as Claims

describe('JaaS call token', () => {
  it('is RS256-signed with the key id, for the app and room', () => {
    const token = signJaasToken({
      roomName: `${APP_ID}/MedoFlow-abc-1234`,
      user: { id: 'user_1', name: 'Dr. Chen', moderator: true },
    })
    const header = jwt.decode(token, { complete: true })!.header
    assert.equal(header.alg, 'RS256')
    assert.equal(header.kid, KID)
    const c = verify(token)
    assert.equal(c.aud, 'jitsi')
    assert.equal(c.iss, 'chat')
    assert.equal(c.sub, APP_ID)
    assert.equal(c.room, 'MedoFlow-abc-1234', 'the room claim drops the "<appId>/" prefix')
    assert.equal(c.context.user.moderator, 'true')
  })

  it('turns off every 8x8 feature that stores or relays the call', () => {
    const c = verify(signJaasToken({ roomName: `${APP_ID}/r`, user: { id: 'u', name: 'Anika' } }))
    for (const f of ['recording', 'livestreaming', 'transcription', 'outbound-call']) {
      assert.equal(c.context.features[f], 'false', f)
    }
  })

  it('carries an opaque id and a display name only — no email', () => {
    const c = verify(signJaasToken({ roomName: `${APP_ID}/r`, user: { id: 'u_9', name: 'Anika' } }))
    assert.deepEqual(Object.keys(c.context.user).sort(), ['id', 'moderator', 'name'])
    assert.equal(c.context.user.moderator, 'false')
    assert.equal(JSON.stringify(c).includes('@'), false)
  })

  it(`expires after ${JAAS_TOKEN_TTL_MINUTES} minutes`, () => {
    const c = verify(signJaasToken({ roomName: `${APP_ID}/r`, user: { id: 'u', name: 'A' } }))
    const minutes = (c.exp - Math.floor(Date.now() / 1000)) / 60
    assert.ok(
      minutes > JAAS_TOKEN_TTL_MINUTES - 1 && minutes <= JAAS_TOKEN_TTL_MINUTES,
      `${minutes}`
    )
    assert.ok(c.nbf <= Math.floor(Date.now() / 1000))
  })

  it('room names live under the app id; foreign rooms are recognised', () => {
    const name = generateRoomName('MedoFlow-sess')
    assert.match(name, new RegExp(`^${APP_ID}/MedoFlow-sess-[0-9a-f]{8}$`))
    assert.equal(isOwnRoom(name), true)
    assert.equal(isOwnRoom('MedoFlow-old-meet-jit-si-room'), false)
    assert.equal(isOwnRoom(null), false)
  })

  it('buildVideoRoom points at 8x8.vc with a verifiable token', () => {
    const room = buildVideoRoom({ roomName: `${APP_ID}/r`, user: { id: 'u', name: 'A' } })
    assert.equal(room.domain, '8x8.vc')
    assert.equal(room.roomUrl, `https://8x8.vc/${APP_ID}/r`)
    assert.equal(verify(room.jwt).sub, APP_ID)
  })

  it('display names are minimal: "Dr. <surname>" and the first name', () => {
    assert.equal(providerDisplayName({ lastName: 'Chen' }), 'Dr. Chen')
    assert.equal(providerDisplayName(null), 'Provider')
    assert.equal(patientDisplayName('Anika Patel'), 'Anika')
    assert.equal(patientDisplayName('  '), 'Patient')
    assert.equal(patientDisplayName(null), 'Patient')
  })
})

describe('without JaaS config', () => {
  it('every entry point answers 503 video_not_configured', () => {
    for (const vars of [
      {},
      { JAAS_APP_ID: APP_ID, JAAS_KID: KID },
      { JAAS_APP_ID: APP_ID, JAAS_PRIVATE_KEY: ESCAPED_KEY },
    ]) {
      configure(vars)
      for (const call of [
        () => generateRoomName(),
        () => signJaasToken({ roomName: 'r', user: { id: 'u', name: 'A' } }),
        () => buildVideoRoom({ roomName: 'r', user: { id: 'u', name: 'A' } }),
      ]) {
        assert.throws(call, (e: { statusCode?: number; code?: string }) => {
          assert.equal(e.statusCode, 503)
          assert.equal(e.code, 'video_not_configured')
          return true
        })
      }
    }
  })
})

describe('boot checks (videoConfigProblems)', () => {
  const full = { JAAS_APP_ID: APP_ID, JAAS_KID: KID, JAAS_PRIVATE_KEY: ESCAPED_KEY }
  const fatal = (env: NodeJS.ProcessEnv) =>
    videoConfigProblems(env)
      .filter((p) => p.fatal)
      .map((p) => p.message)

  it('unset: one warning, video disabled', () => {
    const problems = videoConfigProblems({ NODE_ENV: 'production' })
    assert.equal(problems.length, 1)
    assert.equal(problems[0]!.fatal, false)
    assert.match(problems[0]!.message, /video consultations are disabled/)
  })

  it('production needs a BAA decision', () => {
    assert.equal(fatal({ NODE_ENV: 'production', ...full }).length, 1)
    assert.match(fatal({ NODE_ENV: 'production', ...full })[0]!, /VIDEO_PHI_POLICY/)
    assert.match(
      fatal({ NODE_ENV: 'production', ...full, VIDEO_PHI_POLICY: 'yes' })[0]!,
      /VIDEO_PHI_POLICY/
    )
    for (const policy of ['baa-signed', 'synthetic-data-only']) {
      assert.deepEqual(fatal({ NODE_ENV: 'production', ...full, VIDEO_PHI_POLICY: policy }), [])
    }
    assert.deepEqual(fatal({ NODE_ENV: 'development', ...full }), [], 'only production asks')
  })

  it('partial or broken config is named — never echoed', () => {
    const env = { NODE_ENV: 'production', VIDEO_PHI_POLICY: 'synthetic-data-only' }
    assert.deepEqual(fatal({ ...env, JAAS_APP_ID: APP_ID, JAAS_PRIVATE_KEY: ESCAPED_KEY }), [
      'JAAS_KID is not set',
    ])
    assert.match(fatal({ ...env, JAAS_APP_ID: APP_ID, JAAS_KID: KID })[0]!, /JAAS_PRIVATE_KEY/)
    assert.match(
      fatal({
        ...env,
        JAAS_APP_ID: APP_ID,
        JAAS_KID: KID,
        JAAS_PRIVATE_KEY_PATH: './nope.pem',
      })[0]!,
      /JAAS_PRIVATE_KEY_PATH cannot be read/
    )
    const broken = fatal({ ...env, ...full, JAAS_PRIVATE_KEY: 'not-a-key-SECRETVALUE' })
    assert.match(broken[0]!, /not a valid PEM private key/)
    assert.equal(broken.join(' ').includes('SECRETVALUE'), false)
  })

  it('is part of boot validation (collectEnvProblems)', () => {
    const messages = collectEnvProblems({ NODE_ENV: 'production', ...full })
      .filter((p) => p.fatal)
      .map((p) => p.message)
    assert.ok(messages.some((m) => m.includes('VIDEO_PHI_POLICY')))
  })
})

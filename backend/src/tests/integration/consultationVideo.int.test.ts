/**
 * Video consultations (8x8 JaaS) over HTTP against Postgres (enforce + RLS).
 *
 *  - Only the session's own provider opens the room and is moderator.
 *  - Only the session's own patient (or the join link) gets a participant
 *    token; other providers and patients of the same clinic get 404, as does
 *    another clinic.
 *  - The join link stops issuing tokens once it expires or the call has ended.
 *  - Tokens carry no email and turn 8x8 recording / streaming off.
 *  - Without JaaS config every video endpoint answers 503 video_not_configured.
 *  - Room creation and every issued token are audited with ids only.
 *
 * Tokens are signed with a key pair generated here; nothing reaches 8x8.
 */
import { generateKeyPairSync } from 'crypto'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, FIXTURE_PASSWORD, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

const APP_ID = 'vpaas-magic-cookie-inttest01'
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const JAAS_ENV = {
  JAAS_APP_ID: APP_ID,
  JAAS_KID: `${APP_ID}/kid1`,
  JAAS_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
}
const JAAS_VARS = [...Object.keys(JAAS_ENV), 'JAAS_PRIVATE_KEY_PATH']
const savedEnv: Record<string, string | undefined> = {}

function setJaas(on: boolean) {
  for (const name of JAAS_VARS) delete process.env[name]
  if (on) Object.assign(process.env, JAAS_ENV)
}

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
const tokens = {} as Record<
  'provider' | 'patient' | 'otherProvider' | 'otherPatient' | 'bProvider',
  string
>
let sessionId = ''
let joinToken = ''

type Claims = {
  sub: string
  room: string
  context: { user: Record<string, string>; features: Record<string, string> }
}
const claims = (token: string) =>
  jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as unknown as Claims

const createRoom = (token: string) =>
  api(server.url, `/consultations/${sessionId}/video-room`, { token, body: {} })
const videoToken = (token: string) =>
  api(server.url, `/consultations/${sessionId}/video-token`, { token })
const joinLinkToken = () => api(server.url, `/consultations/join/${joinToken}/video-token`)

async function extraUser(role: 'PROVIDER' | 'PATIENT', key: string) {
  const user = await adminDb.user.create({
    data: {
      clinicId: A.clinicId,
      name: `${key} video`,
      email: `${key}.${Date.now()}@example.test`,
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
      role,
    },
  })
  if (role === 'PROVIDER') {
    await adminDb.provider.create({
      data: { clinicId: A.clinicId, userId: user.id, firstName: 'Other', lastName: 'Clinician' },
    })
  } else {
    await adminDb.patientClinicMembership.create({
      data: { clinicId: A.clinicId, patientId: user.id },
    })
  }
  return (await login(server.url, user.email)).accessToken
}

beforeAll(async () => {
  for (const name of JAAS_VARS) savedEnv[name] = process.env[name]
  setJaas(true)
  server = await startServer()
  A = await createClinicFixture('video-a')
  B = await createClinicFixture('video-b')
  tokens.provider = (await login(server.url, A.users.provider.email)).accessToken
  tokens.patient = (await login(server.url, A.users.patient.email)).accessToken
  tokens.bProvider = (await login(server.url, B.users.provider.email)).accessToken
  tokens.otherProvider = await extraUser('PROVIDER', 'otherprovider')
  tokens.otherPatient = await extraUser('PATIENT', 'otherpatient')

  const started = await api(server.url, `/appointments/${A.appointmentId}/consultation/start`, {
    token: tokens.provider,
    body: {},
  })
  expect(started.status).toBe(201)
  sessionId = started.body.data.session.id
  joinToken = started.body.data.session.joinToken
})

afterEach(async () => {
  setJaas(true)
  await adminDb.consultationSession.update({
    where: { id: sessionId },
    data: { status: 'READY', joinTokenExpiresAt: new Date(Date.now() + 3_600_000) },
  })
})

afterAll(async () => {
  for (const name of JAAS_VARS) delete process.env[name]
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v
  await server?.close()
})

describe('the session provider opens the room', () => {
  it('as moderator, under the JaaS app, with no email and 8x8 recording off', async () => {
    const res = await createRoom(tokens.provider)
    expect(res.status).toBe(201)
    const room = res.body.data
    expect(room.domain).toBe('8x8.vc')
    expect(room.roomName.startsWith(`${APP_ID}/MedoFlow-`)).toBe(true)
    const c = claims(room.jwt)
    expect(c.sub).toBe(APP_ID)
    expect(`${APP_ID}/${c.room}`).toBe(room.roomName)
    expect(c.context.user.moderator).toBe('true')
    expect(c.context.user.name).toMatch(/^Dr\. Provider /)
    expect(c.context.user.email).toBeUndefined()
    expect(c.context.features).toMatchObject({
      recording: 'false',
      livestreaming: 'false',
      transcription: 'false',
    })
  })

  it('reuses the open room on a second call (e.g. after a tab refresh)', async () => {
    const first = (await createRoom(tokens.provider)).body.data.roomName
    const second = (await createRoom(tokens.provider)).body.data.roomName
    expect(second).toBe(first)
  })

  it('another provider of the same clinic cannot open or join it', async () => {
    expect((await createRoom(tokens.otherProvider)).status).toBe(404)
    expect((await videoToken(tokens.otherProvider)).status).toBe(404)
  })

  it('another clinic cannot see the session at all', async () => {
    expect((await createRoom(tokens.bProvider)).status).toBe(404)
    expect((await videoToken(tokens.bProvider)).status).toBe(404)
  })
})

describe('the patient joins', () => {
  it('signed in: a participant token with the first name only', async () => {
    await createRoom(tokens.provider)
    const res = await videoToken(tokens.patient)
    expect(res.status).toBe(200)
    const c = claims(res.body.data.jwt)
    expect(c.context.user.moderator).toBe('false')
    expect(c.context.user.name).toBe('patient')
    expect(JSON.stringify(c)).not.toContain('@')
  })

  it('another patient of the same clinic gets 404', async () => {
    await createRoom(tokens.provider)
    expect((await videoToken(tokens.otherPatient)).status).toBe(404)
  })

  it('by join link: a participant token while the link is valid', async () => {
    await createRoom(tokens.provider)
    const res = await joinLinkToken()
    expect(res.status).toBe(200)
    expect(claims(res.body.data.jwt).context.user.moderator).toBe('false')
  })

  it('by join link: 410 once the link has expired', async () => {
    await createRoom(tokens.provider)
    await adminDb.consultationSession.update({
      where: { id: sessionId },
      data: { joinTokenExpiresAt: new Date(Date.now() - 1000) },
    })
    const res = await joinLinkToken()
    expect(res.status).toBe(410)
    expect(res.body.code).toBe('token_expired')
  })

  it('by join link or signed in: 410 once the call has ended', async () => {
    await createRoom(tokens.provider)
    await adminDb.consultationSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED' },
    })
    const viaLink = await joinLinkToken()
    expect(viaLink.status).toBe(410)
    expect(viaLink.body.code).toBe('consultation_ended')
    expect((await videoToken(tokens.patient)).status).toBe(410)
  })

  it('a new call after the end gets a new room, and the link works again', async () => {
    const before = (await createRoom(tokens.provider)).body.data.roomName
    await adminDb.consultationSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED' },
    })
    const after = (await createRoom(tokens.provider)).body.data.roomName
    expect(after).not.toBe(before)
    expect((await joinLinkToken()).status).toBe(200)
  })
})

describe('without JaaS config', () => {
  it('every video endpoint answers 503 video_not_configured', async () => {
    setJaas(false)
    for (const res of [
      await createRoom(tokens.provider),
      await videoToken(tokens.patient),
      await joinLinkToken(),
    ]) {
      expect(res.status).toBe(503)
      expect(res.body.code).toBe('video_not_configured')
    }
  })
})

describe('audit', () => {
  it('room creation and each token are logged with ids only', async () => {
    await createRoom(tokens.provider)
    await videoToken(tokens.patient)
    const rows = await adminDb.auditLog.findMany({
      where: { entityId: sessionId, action: { in: ['VIDEO_ROOM_CREATED', 'VIDEO_TOKEN_ISSUED'] } },
    })
    expect(rows.some((r) => r.action === 'VIDEO_ROOM_CREATED')).toBe(true)
    const issued = rows.filter((r) => r.action === 'VIDEO_TOKEN_ISSUED')
    expect(issued.length).toBeGreaterThan(0)
    expect(issued.some((r) => (r.newValue as { moderator: boolean }).moderator === false)).toBe(
      true
    )
    const text = JSON.stringify(rows.map((r) => [r.oldValue, r.newValue]))
    expect(text).not.toMatch(/@|patient |Provider /)
  })
})

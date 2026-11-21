/**
 * Demo feedback WS2: live captions while a consultation is recorded,
 * over HTTP against Postgres (enforce + RLS), with the in-process mock
 * speech-to-text provider.
 *
 *  - Same gate as recording: consent GRANTED and the recording running.
 *  - Only the session's own provider; patients, other providers and other
 *    clinics are refused.
 *  - Each segment comes back as text; nothing is stored, nothing is logged.
 *  - Provider failures map to safe codes; oversize / non-audio uploads refused.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { adminDb, api, FIXTURE_PASSWORD, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { MOCK_TRANSCRIPT, mockScribeControl } from '../../services/ai/mock'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let sessionId = ''
const t = {} as Record<'provider' | 'patient' | 'otherProvider' | 'bProvider', string>
const LINES = MOCK_TRANSCRIPT.split('\n')

function segment(
  token: string,
  opts: { seq?: number; bytes?: number; type?: string; omitFile?: boolean } = {}
) {
  const form = new FormData()
  form.append('segment', String(opts.seq ?? 0))
  if (!opts.omitFile) {
    form.append(
      'audio',
      new Blob([crypto.randomBytes(opts.bytes ?? 4096)], { type: opts.type ?? 'audio/webm' }),
      'segment.webm'
    )
  }
  return fetch(`${server.url}/consultations/${sessionId}/live-transcript`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-medoflow-client': 'web' },
    body: form,
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }))
}

const setState = (data: { consentStatus?: any; recordingStatus?: any; status?: any }) =>
  adminDb.consultationSession.update({ where: { id: sessionId }, data })

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('live-a')
  B = await createClinicFixture('live-b')
  t.provider = (await login(server.url, A.users.provider.email)).accessToken
  t.patient = (await login(server.url, A.users.patient.email)).accessToken
  t.bProvider = (await login(server.url, B.users.provider.email)).accessToken
  const other = await adminDb.user.create({
    data: {
      clinicId: A.clinicId,
      name: 'Other live provider',
      email: `otherlive.${Date.now()}@example.test`,
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
      role: 'PROVIDER',
    },
  })
  await adminDb.provider.create({
    data: { clinicId: A.clinicId, userId: other.id, firstName: 'Other', lastName: 'Live' },
  })
  t.otherProvider = (await login(server.url, other.email)).accessToken

  const started = await api(server.url, `/appointments/${A.appointmentId}/consultation/start`, {
    token: t.provider,
    body: {},
  })
  expect(started.status, JSON.stringify(started.body)).toBe(201)
  sessionId = started.body.data.session.id
})
afterAll(() => server.close())
beforeEach(() => mockScribeControl.reset())

describe('the recording gate', () => {
  it('refuses captions before consent, and before the recording runs', async () => {
    await setState({ consentStatus: 'PENDING', recordingStatus: 'NOT_STARTED', status: 'READY' })
    const noConsent = await segment(t.provider)
    expect(noConsent.status).toBe(400)
    expect(noConsent.body.code).toBe('consent_required')

    await setState({ consentStatus: 'GRANTED' })
    const notRecording = await segment(t.provider)
    expect(notRecording.status).toBe(409)
    expect(notRecording.body.code).toBe('not_recording')
    expect(mockScribeControl.calls.filter((c) => c.kind === 'stt')).toHaveLength(0)
  })

  it('once recording, each segment comes back as text, and nothing is stored', async () => {
    await setState({ consentStatus: 'GRANTED', recordingStatus: 'NOT_STARTED', status: 'READY' })
    const rec = await api(server.url, `/consultations/${sessionId}/recording/start`, {
      token: t.provider,
      body: {},
    })
    expect(rec.status, JSON.stringify(rec.body)).toBe(200)

    // `text` stays the provider's wording verbatim, prefix included, so a
    // client that reads only `text` is unaffected by CTO-41.
    const first = await segment(t.provider, { seq: 0 })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.data).toEqual({
      text: LINES[0],
      segment: 0,
      turns: [{ speaker: 'PROVIDER', text: 'How have you been since the last visit?' }],
    })
    const second = await segment(t.provider, { seq: 1 })
    expect(second.body.data).toEqual({
      text: LINES[1],
      segment: 1,
      turns: [
        {
          speaker: 'PATIENT',
          text: 'Better. The fatigue is easing, but I still feel low on energy by mid-afternoon.',
        },
      ],
    })

    // The provider got the audio as audio/webm.
    expect(mockScribeControl.calls.filter((c) => c.kind === 'stt')).toEqual([
      expect.objectContaining({ mimeType: 'audio/webm', bytes: 4096 }),
      expect.objectContaining({ mimeType: 'audio/webm', bytes: 4096 }),
    ])

    const row = await adminDb.consultationSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(row.transcriptText).toBeNull()
    expect(row.recordingStatus).toBe('RECORDING')
    expect(row.aiScribeSessionId).toBeNull()
  })
})

describe('speaker turns (CTO-41)', () => {
  beforeEach(() => setState({ consentStatus: 'GRANTED', recordingStatus: 'RECORDING' }))

  it('a segment that continues a turn comes back unlabelled, not guessed at', async () => {
    // MOCK_TRANSCRIPT's last line deliberately carries no prefix.
    const res = await segment(t.provider, { seq: 5 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data).toEqual({
      text: LINES[5],
      segment: 5,
      turns: [
        {
          speaker: null,
          text: 'and magnesium glycinate 400 mg at night, two bottles. Let us recheck in six weeks.',
        },
      ],
    })
  })

  it('a provider that cannot diarize returns one unlabelled turn, prefix unparsed', async () => {
    mockScribeControl.speakerTurns = false
    const res = await segment(t.provider, { seq: 0 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    // Whisper cannot label, so a spoken "Provider:" must never become a speaker.
    expect(res.body.data).toEqual({
      text: LINES[0],
      segment: 0,
      turns: [{ speaker: null, text: LINES[0] }],
    })
  })
})

describe('who may ask', () => {
  beforeEach(() => setState({ consentStatus: 'GRANTED', recordingStatus: 'RECORDING' }))

  it('patients, other providers of the clinic and other clinics are refused', async () => {
    expect((await segment(t.patient)).status).toBe(403)
    expect((await segment(t.otherProvider)).status).toBe(403)
    expect([403, 404]).toContain((await segment(t.bProvider)).status)
    expect(mockScribeControl.calls.filter((c) => c.kind === 'stt')).toHaveLength(0)
  })
})

describe('bad input and provider failures', () => {
  beforeEach(() => setState({ consentStatus: 'GRANTED', recordingStatus: 'RECORDING' }))

  it('refuses a missing file, a non-audio file and an oversize segment', async () => {
    expect((await segment(t.provider, { omitFile: true })).status).toBe(400)
    expect((await segment(t.provider, { type: 'application/pdf' })).status).toBe(400)
    const big = await segment(t.provider, { bytes: 3 * 1024 * 1024 })
    expect(big.status).toBe(413)
    expect(big.body.code).toBe('file_too_large')
  })

  it('a provider outage is a retryable 503 with a safe code; a rejection a 502', async () => {
    mockScribeControl.failNext('stt', 'ai_unavailable')
    const down = await segment(t.provider)
    expect(down.status).toBe(503)
    expect(down.body.code).toBe('ai_unavailable')

    mockScribeControl.failNext('stt', 'ai_rejected')
    const rejected = await segment(t.provider)
    expect(rejected.status).toBe(502)
    expect(rejected.body.code).toBe('ai_rejected')
  })

  it('caption text never reaches the logs (B2.6)', async () => {
    const logged: string[] = []
    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    }
    for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
      console[k] = (...args: unknown[]) => logged.push(args.map(String).join(' '))
    }
    try {
      for (let seq = 0; seq < LINES.length; seq++) {
        expect((await segment(t.provider, { seq })).status).toBe(200)
      }
      mockScribeControl.failNext('stt', 'ai_unavailable')
      await segment(t.provider, { seq: 2 })
    } finally {
      Object.assign(console, originals)
    }
    for (const line of logged) {
      for (const text of LINES) expect(line).not.toContain(text)
    }
  })

  it('turn text never reaches the logs either (CTO-41)', async () => {
    // The test above compares against the prefixed lines, so a log of a turn
    // *body* would slip past it. Turns are PHI too.
    const bodies = LINES.map((l) => l.replace(/^(provider|patient)[ \t]*:[ \t]*/i, '')).filter(
      (b) => b.length > 12
    )
    expect(bodies.length).toBe(LINES.length)

    const logged: string[] = []
    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    }
    for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
      console[k] = (...args: unknown[]) => logged.push(args.map(String).join(' '))
    }
    try {
      for (let seq = 0; seq < LINES.length; seq++) {
        expect((await segment(t.provider, { seq })).status).toBe(200)
      }
      mockScribeControl.failNext('stt', 'ai_rejected')
      await segment(t.provider, { seq: 3 })
    } finally {
      Object.assign(console, originals)
    }
    for (const line of logged) {
      for (const body of bodies) expect(line).not.toContain(body)
    }
  })
})

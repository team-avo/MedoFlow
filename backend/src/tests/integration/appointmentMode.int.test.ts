/**
 * CTO-31: virtual vs in-person appointments.
 *
 *  - Appointments carry a mode, from the service's default and changeable at
 *    booking (patients and staff); existing rows are IN_PERSON.
 *  - A confirmed VIRTUAL booking gets its consultation session, an 8x8 JaaS
 *    room and the patient's join link at once; the provider's "Start video
 *    call" reuses that room (one click in).
 *  - IN_PERSON creates nothing for video; the session reports the mode so the
 *    consult room shows audio recording only.
 */
import { generateKeyPairSync } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'

const APP_ID = 'vpaas-magic-cookie-modetest1'
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const JAAS_ENV: Record<string, string> = {
  JAAS_APP_ID: APP_ID,
  JAAS_KID: `${APP_ID}/kid1`,
  JAAS_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
  VIDEO_PHI_POLICY: 'synthetic-data-only',
}
const saved: Record<string, string | undefined> = {}

let server: TestServer
let fx: ClinicFixture
let owner = ''
let patient = ''
let provider = ''

beforeAll(async () => {
  for (const [k, v] of Object.entries(JAAS_ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  server = await startServer()
  fx = await createClinicFixture('mode')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  patient = (await login(server.url, fx.users.patient.email)).accessToken
  provider = (await login(server.url, fx.users.provider.email)).accessToken
})
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await server.close()
})

const book = (token: string, body: Record<string, unknown>) =>
  api(server.url, '/appointments', {
    token,
    body: {
      providerId: fx.providerId,
      serviceId: fx.serviceId,
      locationId: fx.locationId,
      patientId: fx.users.patient.id,
      ...body,
    },
  })

describe('appointment mode', () => {
  it('defaults to the service (IN_PERSON) and creates nothing for video', async () => {
    const res = await book(owner, { ...slot(10, 9), bookingSource: 'PHONE' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const appt = await adminDb.appointment.findUniqueOrThrow({
      where: { id: res.body.data.appointment.id },
    })
    expect(appt.mode).toBe('IN_PERSON')
    expect(await adminDb.consultationSession.count({ where: { appointmentId: appt.id } })).toBe(0)

    // The consult room learns the mode (audio only for in person).
    const start = await api(server.url, `/appointments/${appt.id}/consultation/start`, {
      token: provider,
      body: {},
    })
    expect(start.status, JSON.stringify(start.body)).toBe(201)
    expect(start.body.data.session.appointment.mode).toBe('IN_PERSON')
  })

  it('a service can default to VIRTUAL; a booking can override it', async () => {
    await adminDb.service.update({ where: { id: fx.serviceId }, data: { defaultMode: 'VIRTUAL' } })
    try {
      const inPerson = await book(owner, {
        ...slot(10, 11),
        mode: 'IN_PERSON',
        bookingSource: 'PHONE',
      })
      expect(inPerson.status).toBe(201)
      expect(
        (
          await adminDb.appointment.findUniqueOrThrow({
            where: { id: inPerson.body.data.appointment.id },
          })
        ).mode
      ).toBe('IN_PERSON')
      const byDefault = await book(owner, { ...slot(10, 13), bookingSource: 'PHONE' })
      expect(
        (
          await adminDb.appointment.findUniqueOrThrow({
            where: { id: byDefault.body.data.appointment.id },
          })
        ).mode
      ).toBe('VIRTUAL')
    } finally {
      await adminDb.service.update({
        where: { id: fx.serviceId },
        data: { defaultMode: 'IN_PERSON' },
      })
    }
  })

  it('a confirmed VIRTUAL booking gets a session, a JaaS room and a join link at once; the provider reuses the room', async () => {
    const res = await book(patient, { ...slot(11, 9), mode: 'VIRTUAL' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const id = res.body.data.appointment.id as string
    const session = await adminDb.consultationSession.findFirstOrThrow({
      where: { appointmentId: id },
    })
    expect(session.meetingRoomName).toMatch(new RegExp(`^${APP_ID}/MedoFlow-`))
    expect(session.joinToken).toBeTruthy()
    const audits = await adminDb.auditLog.findMany({ where: { entityId: session.id } })
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['CONSULTATION_SESSION_CREATED', 'VIDEO_ROOM_CREATED'])
    )

    // The patient's join link works before the visit.
    const joined = await api(server.url, `/consultations/join/${session.joinToken}`)
    expect(joined.status).toBe(200)

    // One click in for the provider: the same session and the same room.
    const start = await api(server.url, `/appointments/${id}/consultation/start`, {
      token: provider,
      body: {},
    })
    expect(start.body.data.session.id).toBe(session.id)
    const room = await api(server.url, `/consultations/${session.id}/video-room`, {
      token: provider,
      body: {},
    })
    expect(room.status, JSON.stringify(room.body)).toBe(201)
    expect(room.body.data.roomName).toBe(session.meetingRoomName)
  })
})

describe('in-person consent (CTO-30/31)', () => {
  it('the visit provider records verbal consent; nobody else can; a decline stands', async () => {
    const res = await book(owner, { ...slot(12, 9), bookingSource: 'WALK_IN' })
    const id = res.body.data.appointment.id as string
    const start = await api(server.url, `/appointments/${id}/consultation/start`, {
      token: provider,
      body: {},
    })
    const sessionId = start.body.data.session.id as string
    expect(start.body.data.session.consentStatus).toBe('PENDING')
    // Front desk / patient can't attest.
    const frontDesk = (await login(server.url, fx.users.frontDesk.email)).accessToken
    expect(
      (
        await api(server.url, `/consultations/${sessionId}/consent/attest`, {
          token: frontDesk,
          body: {},
        })
      ).status
    ).toBe(403)
    const ok = await api(server.url, `/consultations/${sessionId}/consent/attest`, {
      token: provider,
      body: {},
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.data.session.consentStatus).toBe('GRANTED')
    expect(
      await adminDb.auditLog.count({
        where: { entityId: sessionId, action: 'CONSENT_ATTESTED_VERBAL' },
      })
    ).toBe(1)
    // Recording can now start.
    const rec = await api(server.url, `/consultations/${sessionId}/recording/start`, {
      token: provider,
      body: {},
    })
    expect(rec.status, JSON.stringify(rec.body)).toBe(200)

    // A decline is never overridden.
    const other = await book(owner, { ...slot(12, 11), bookingSource: 'WALK_IN' })
    const s2 = await api(
      server.url,
      `/appointments/${other.body.data.appointment.id}/consultation/start`,
      {
        token: provider,
        body: {},
      }
    )
    await adminDb.consultationSession.update({
      where: { id: s2.body.data.session.id },
      data: { consentStatus: 'DECLINED' },
    })
    expect(
      (
        await api(server.url, `/consultations/${s2.body.data.session.id}/consent/attest`, {
          token: provider,
          body: {},
        })
      ).status
    ).toBe(409)
  })
})

describe('auto-ended idle call (CTO-35)', () => {
  it('is audited with ids only, by the session provider or patient; nobody else', async () => {
    const res = await book(patient, { ...slot(13, 9), mode: 'VIRTUAL' })
    const session = await adminDb.consultationSession.findFirstOrThrow({
      where: { appointmentId: res.body.data.appointment.id },
    })
    const ok = await api(server.url, `/consultations/${session.id}/video/auto-ended`, {
      token: provider,
      body: {},
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const row = await adminDb.auditLog.findFirstOrThrow({
      where: { entityId: session.id, action: 'VIDEO_CALL_AUTO_ENDED' },
    })
    expect(row.newValue).toEqual({ by: 'provider' })
    expect(
      (
        await api(server.url, `/consultations/${session.id}/video/auto-ended`, {
          token: patient,
          body: {},
        })
      ).status
    ).toBe(200)
    const other = await createClinicFixture('mode-other')
    const stranger = (await login(server.url, other.users.provider.email)).accessToken
    expect(
      (
        await api(server.url, `/consultations/${session.id}/video/auto-ended`, {
          token: stranger,
          body: {},
        })
      ).status
    ).toBe(404)
  })
})

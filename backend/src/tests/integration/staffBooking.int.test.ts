/**
 * CTO-24: the owner (often the doctor) and admins create appointments
 * themselves: walk-ins and phone bookings, no website needed.
 *
 *  - POST /patients: owner / front desk / custom role with `patients.create`
 *    add a patient with an email or a phone (no password), with an optional
 *    invite link; an existing patient is linked, not duplicated.
 *  - POST /appointments: owner, front desk and custom roles with
 *    `appointments.create`; a provider (or a custom role without it) is 403;
 *    another clinic's patient is 404.
 *  - Booking source WALK_IN / PHONE is recorded (an owner booking used to be
 *    PUBLIC); staff skip the online minimum notice; "collect at desk" confirms
 *    a prepay service with nothing charged online.
 *  - The overlap constraint still answers 409; APPOINTMENT_CREATED names the
 *    staff actor.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, FIXTURE_PASSWORD, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'

let server: TestServer
let fx: ClinicFixture
let other: ClinicFixture
let owner: string
let frontDesk: string
let provider: string

beforeAll(async () => {
  server = await startServer()
  fx = await createClinicFixture('staffbook')
  other = await createClinicFixture('staffbook-other')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  frontDesk = (await login(server.url, fx.users.frontDesk.email)).accessToken
  provider = (await login(server.url, fx.users.provider.email)).accessToken
})
afterAll(() => server.close())

async function customRoleUser(permissions: string[]) {
  const role = await adminDb.customRole.create({
    data: { clinicId: fx.clinicId, name: `Role ${crypto.randomUUID()}`, permissions },
  })
  const email = `staff.${crypto.randomBytes(4).toString('hex')}@example.test`
  await adminDb.user.create({
    data: {
      clinicId: fx.clinicId,
      name: 'Custom Staff',
      email,
      role: 'STAFF',
      customRoleId: role.id,
      password: await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id }),
    },
  })
  return (await login(server.url, email)).accessToken
}

const book = (token: string, body: Record<string, unknown>) =>
  api(server.url, '/appointments', { token, body })

const booking = (patientId: string, at: { startTime: string; endTime: string }) => ({
  providerId: fx.providerId,
  serviceId: fx.serviceId,
  locationId: fx.locationId,
  patientId,
  ...at,
})

describe('POST /patients (walk-in / phone patient)', () => {
  it('the owner adds a patient by email with an invite link; repeating links, never duplicates', async () => {
    const email = `walkin.${crypto.randomBytes(3).toString('hex')}@example.test`
    const res = await api(server.url, '/patients', {
      token: owner,
      body: { name: 'Wanda Walkin', email, phone: '555-0142' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.created).toBe(true)
    expect(res.body.data.patient).toMatchObject({ name: 'Wanda Walkin', email })
    // Works without SMTP: the link is returned for staff to copy.
    expect(res.body.data.inviteLink).toMatch(/\/set-password\?token=[0-9a-f]{64}$/)

    const again = await api(server.url, '/patients', {
      token: frontDesk,
      body: { name: 'Wanda W', email },
    })
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ created: false, inviteLink: null })
    expect(again.body.data.patient.id).toBe(res.body.data.patient.id)
    expect(await adminDb.user.count({ where: { email } })).toBe(1)
    expect(
      await adminDb.patientClinicMembership.count({
        where: { clinicId: fx.clinicId, patientId: res.body.data.patient.id },
      })
    ).toBe(1)
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { entityId: res.body.data.patient.id, action: 'PATIENT_CREATED' },
    })
    expect(audit.performedById).toBe(fx.users.admin.id)
  })

  it('a phone-only patient gets no address and no invite; nothing identifies them in the email field', async () => {
    const res = await api(server.url, '/patients', {
      token: owner,
      body: { name: 'Phil Phone', phone: '555-0177' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.patient.email).toBeNull()
    expect(res.body.data.inviteLink).toBeNull()
    const row = await adminDb.user.findUniqueOrThrow({ where: { id: res.body.data.patient.id } })
    expect(row.email).toMatch(/^walkin\+[0-9a-f-]+@patients\.invalid$/)
    expect(row.role).toBe('PATIENT')
  })

  it('validates input and roles', async () => {
    expect(
      (await api(server.url, '/patients', { token: owner, body: { name: 'No Contact' } })).status
    ).toBe(400)
    // A staff account's email is never turned into a patient.
    expect(
      (
        await api(server.url, '/patients', {
          token: owner,
          body: { name: 'Front Desk', email: fx.users.frontDesk.email },
        })
      ).status
    ).toBe(409)
    expect(
      (
        await api(server.url, '/patients', {
          token: provider,
          body: { name: 'X Y', phone: '555-0100' },
        })
      ).status
    ).toBe(403)
    const withPerm = await customRoleUser(['patients.create'])
    expect(
      (
        await api(server.url, '/patients', {
          token: withPerm,
          body: { name: 'X Y', phone: '555-0100' },
        })
      ).status
    ).toBe(201)
    const without = await customRoleUser(['patients.view'])
    expect(
      (
        await api(server.url, '/patients', {
          token: without,
          body: { name: 'X Y', phone: '555-0100' },
        })
      ).status
    ).toBe(403)
  })
})

describe('POST /appointments by staff', () => {
  it('the owner books a walk-in now: WALK_IN recorded, no minimum notice, audited with the owner', async () => {
    await adminDb.service.update({
      where: { id: fx.serviceId },
      data: { minimumNoticeMinutes: 24 * 60 },
    })
    const p = await api(server.url, '/patients', {
      token: owner,
      body: { name: 'Nora Now', phone: '555-0150' },
    })
    const start = new Date(Date.now() + 5 * 60_000)
    const at = {
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    }
    const res = await book(owner, {
      ...booking(p.body.data.patient.id, at),
      bookingSource: 'WALK_IN',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const appt = await adminDb.appointment.findUniqueOrThrow({
      where: { id: res.body.data.appointment.id },
    })
    expect(appt).toMatchObject({
      bookingSource: 'WALK_IN',
      status: 'CONFIRMED',
      createdById: fx.users.admin.id,
    })
    const audit = await adminDb.auditLog.findFirstOrThrow({
      where: { entityId: appt.id, action: 'APPOINTMENT_CREATED' },
    })
    expect(audit.performedById).toBe(fx.users.admin.id)
    expect(audit.newValue).toMatchObject({ bookingSource: 'WALK_IN' })

    // The overlap rule still applies to staff: a second booking is 409.
    const clash = await book(frontDesk, {
      ...booking(fx.users.patient.id, at),
      bookingSource: 'PHONE',
    })
    expect(clash.status).toBe(409)

    // Patients still get the online notice rule.
    const patientToken = (await login(server.url, fx.users.patient.email)).accessToken
    const late = slot(0, 23)
    const patientRes = await book(patientToken, { ...booking(fx.users.patient.id, late) })
    expect([400, 409]).toContain(patientRes.status)
    await adminDb.service.update({ where: { id: fx.serviceId }, data: { minimumNoticeMinutes: 0 } })
  })

  it('front desk books by phone; the owner with no source is FRONT_DESK, never PUBLIC', async () => {
    const phone = await book(frontDesk, {
      ...booking(fx.users.patient.id, slot(5, 9)),
      bookingSource: 'PHONE',
    })
    expect(phone.status, JSON.stringify(phone.body)).toBe(201)
    expect(
      (
        await adminDb.appointment.findUniqueOrThrow({
          where: { id: phone.body.data.appointment.id },
        })
      ).bookingSource
    ).toBe('PHONE')
    const plain = await book(owner, booking(fx.users.patient.id, slot(5, 11)))
    expect(plain.status, JSON.stringify(plain.body)).toBe(201)
    expect(
      (
        await adminDb.appointment.findUniqueOrThrow({
          where: { id: plain.body.data.appointment.id },
        })
      ).bookingSource
    ).toBe('FRONT_DESK')
  })

  it('"collect at desk" confirms a prepay service with nothing charged online', async () => {
    await adminDb.service.update({
      where: { id: fx.serviceId },
      data: { requirePrepayment: true, prepaymentType: 'FULL' },
    })
    try {
      const res = await book(owner, {
        ...booking(fx.users.patient.id, slot(6, 9)),
        bookingSource: 'WALK_IN',
        collectAtDesk: true,
      })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.data.clientSecret).toBeUndefined()
      const appt = await adminDb.appointment.findUniqueOrThrow({
        where: { id: res.body.data.appointment.id },
      })
      expect(appt).toMatchObject({ status: 'CONFIRMED', paymentRequirementType: 'NONE' })
      const audit = await adminDb.auditLog.findFirstOrThrow({
        where: { entityId: appt.id, action: 'APPOINTMENT_CREATED' },
      })
      expect(audit.newValue).toMatchObject({ collectAtDesk: true })
    } finally {
      await adminDb.service.update({
        where: { id: fx.serviceId },
        data: { requirePrepayment: false, prepaymentType: 'NONE' },
      })
    }
  })

  it('roles: provider 403, custom role needs appointments.create, another clinic is 404', async () => {
    expect((await book(provider, booking(fx.users.patient.id, slot(7, 9)))).status).toBe(403)
    const without = await customRoleUser(['appointments.view'])
    expect((await book(without, booking(fx.users.patient.id, slot(7, 10)))).status).toBe(403)
    const withPerm = await customRoleUser(['appointments.create'])
    const ok = await book(withPerm, {
      ...booking(fx.users.patient.id, slot(7, 11)),
      bookingSource: 'PHONE',
    })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)

    // Another clinic's patient is "not found" here, and never enrolled.
    const cross = await book(owner, booking(other.users.patient.id, slot(7, 13)))
    expect(cross.status).toBe(404)
    expect(
      await adminDb.patientClinicMembership.count({
        where: { clinicId: fx.clinicId, patientId: other.users.patient.id },
      })
    ).toBe(0)
    // Another clinic's provider / service: also refused.
    const otherOwner = (await login(server.url, other.users.admin.email)).accessToken
    const foreign = await book(otherOwner, {
      ...booking(other.users.patient.id, slot(7, 15)),
      providerId: fx.providerId,
      serviceId: fx.serviceId,
      locationId: other.locationId,
    })
    expect([400, 404]).toContain(foreign.status)
  })
})

describe('GET /appointments/availability (staff slots)', () => {
  it('lists open slots for staff even while the clinic is still in review', async () => {
    const pending = await createClinicFixture('staffbook-pending')
    await adminDb.tenant.update({
      where: { id: pending.tenantId },
      data: { verificationStatus: 'PENDING_REVIEW' },
    })
    const token = (await login(server.url, pending.users.admin.email)).accessToken
    const date = slot(4, 9).startTime.slice(0, 10)
    const qs = `serviceId=${pending.serviceId}&providerId=${pending.providerId}&locationId=${pending.locationId}&date=${date}`
    const staff = await api(server.url, `/appointments/availability?${qs}`, { token })
    expect(staff.status, JSON.stringify(staff.body)).toBe(200)
    expect(staff.body.data.slots.length).toBeGreaterThan(0)
    // The public API keeps the go-live gate.
    const pub = await api(server.url, `/public/availability?clinicId=${pending.clinicId}&${qs}`)
    expect(pub.status).toBe(404)
    // A provider (not a booker) can't use it.
    const providerToken = (await login(server.url, pending.users.provider.email)).accessToken
    expect(
      (await api(server.url, `/appointments/availability?${qs}`, { token: providerToken })).status
    ).toBe(403)
  })
})

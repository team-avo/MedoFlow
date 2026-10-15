/**
 * Component 1 — Scheduling: booking integrity (B1.1–B1.4) and the recurring
 * series cancel endpoint behind the F1.2 UI. Runs against a real Postgres as
 * the non-owner app role (RLS + tenant guard live), like every integration
 * suite. Synthetic data only.
 *
 *  B1.1  the database refuses an overlapping live appointment for a provider
 *        (direct INSERT bypassing the app), allows the legitimate shapes, and
 *        the advisory lock still answers the app-level 409 first
 *  B1.2  converting a slot hold whose slot became taken → clean 409, nothing
 *        written, the hold stays ACTIVE — via the app check and via the
 *        constraint itself; reschedule is atomic
 *  B1.3  set-based getAvailableDatesInRange matches the pre-B1.3 N×M
 *        implementation on a multi-provider, multi-timezone fixture and issues
 *        a bounded number of queries however long the window
 *  B1.4  concurrent bookings of one slot → exactly one 201, the rest 409
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'
import { legacyGetAvailableDatesInRange, legacyGetAvailableSlots } from './legacyAvailability'
import * as availabilityService from '../../services/availabilityService'
import { onPrismaOperation } from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let frontDesk: string
let patient: string
let adminA: string
let frontDeskB: string

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('sched-a')
  B = await createClinicFixture('sched-b')
  frontDesk = (await login(server.url, A.users.frontDesk.email)).accessToken
  patient = (await login(server.url, A.users.patient.email)).accessToken
  adminA = (await login(server.url, A.users.admin.email)).accessToken
  frontDeskB = (await login(server.url, B.users.frontDesk.email)).accessToken
})
afterAll(() => server.close())

const OVERLAP_CONSTRAINT = 'Appointment_provider_no_overlap'

/** Raw INSERT as the owner — no app code, no advisory lock, no RLS. */
async function rawInsertAppointment(opts: {
  id: string
  clinicId: string
  providerId: string
  serviceId: string
  patientId: string
  start: Date
  end: Date
  status?: string
}) {
  return adminDb.$executeRaw`
    INSERT INTO "Appointment"
      (id, "clinicId", "providerId", "serviceId", "patientId", "startTime", "endTime",
       status, "priceAtBooking", "updatedAt")
    VALUES
      (${opts.id}, ${opts.clinicId}, ${opts.providerId}, ${opts.serviceId}, ${opts.patientId},
       ${opts.start}, ${opts.end}, ${opts.status ?? 'CONFIRMED'}::"AppointmentStatus", 100, now())`
}

const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 12)}`
const at = (s: { startTime: string; endTime: string }) => ({
  start: new Date(s.startTime),
  end: new Date(s.endTime),
})
const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)

describe('B1.1 — Postgres exclusion constraint on Appointment overlap', () => {
  const base = () => ({
    clinicId: A.clinicId,
    providerId: A.providerId,
    serviceId: A.serviceId,
    patientId: A.users.patient.id,
  })

  it('the constraint exists on the table (btree_gist, [) ranges, live statuses only)', async () => {
    const rows = await adminDb.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = '"Appointment"'::regclass AND conname = ${OVERLAP_CONSTRAINT}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.def).toContain('EXCLUDE USING gist')
    expect(rows[0]!.def).toContain(`tsrange("startTime", "endTime", '[)'`)
    expect(rows[0]!.def).toMatch(/CANCELLED.*RESCHEDULED/)
  })

  it('a direct INSERT of an overlapping appointment for the same provider is rejected by the DB', async () => {
    const s = slot(30, 9, 60)
    await rawInsertAppointment({ id: uid('ovl'), ...base(), ...at(s) })
    // Starts inside the first one.
    const inner = slot(30, 9, 30)
    const startsInside = new Date(new Date(inner.startTime).getTime() + 15 * 60_000)
    await expect(
      rawInsertAppointment({
        id: uid('ovl'),
        ...base(),
        start: startsInside,
        end: new Date(startsInside.getTime() + 60 * 60_000),
      })
    ).rejects.toThrow(new RegExp(`23P01|${OVERLAP_CONSTRAINT}`))
    // Fully containing it.
    await expect(
      rawInsertAppointment({
        id: uid('ovl'),
        ...base(),
        start: new Date(new Date(s.startTime).getTime() - 60 * 60_000),
        end: new Date(new Date(s.endTime).getTime() + 60 * 60_000),
      })
    ).rejects.toThrow(new RegExp(`23P01|${OVERLAP_CONSTRAINT}`))
  })

  it('also rejects overlaps written through Prisma (the owner client, not just raw SQL)', async () => {
    const s = slot(31, 9)
    const data = { ...base(), ...{ startTime: at(s).start, endTime: at(s).end }, priceAtBooking: 1 }
    await adminDb.appointment.create({ data })
    const err = await adminDb.appointment.create({ data }).catch((e: unknown) => e)
    expect(errorText(err)).toContain(OVERLAP_CONSTRAINT)
  })

  it('allows back-to-back slots, another provider at the same time, and overlap with CANCELLED / RESCHEDULED rows', async () => {
    const s = slot(32, 9)
    const next = slot(32, 9)
    const nextStart = new Date(new Date(next.endTime).getTime())
    await rawInsertAppointment({ id: uid('ok'), ...base(), ...at(s) })
    // [09:00, 09:30) then [09:30, 10:00): touching, not overlapping.
    await rawInsertAppointment({
      id: uid('ok'),
      ...base(),
      start: nextStart,
      end: new Date(nextStart.getTime() + 30 * 60_000),
    })
    // Same time, provider of another clinic.
    await rawInsertAppointment({
      id: uid('ok'),
      clinicId: B.clinicId,
      providerId: B.providerId,
      serviceId: B.serviceId,
      patientId: B.users.patient.id,
      ...at(s),
    })
    // Dead rows never block.
    for (const status of ['CANCELLED', 'RESCHEDULED']) {
      await rawInsertAppointment({ id: uid('dead'), ...base(), ...at(s), status })
    }
  })

  it('refuses an appointment that ends before it starts (CHECK constraint)', async () => {
    const s = slot(33, 9)
    await expect(
      rawInsertAppointment({ id: uid('bad'), ...base(), start: at(s).end, end: at(s).start })
    ).rejects.toThrow(/Appointment_time_order|23514|range lower bound/)
  })

  it('the advisory lock remains the fast-fail: a second app booking gets the app-level 409, not a DB error', async () => {
    const s = slot(34, 10)
    const body = {
      providerId: A.providerId,
      serviceId: A.serviceId,
      locationId: A.locationId,
      patientId: A.users.patient.id,
      ...s,
    }
    const [r1, r2] = await Promise.all([
      api(server.url, '/appointments', { token: frontDesk, body }),
      api(server.url, '/appointments', { token: frontDesk, body }),
    ])
    const loser = [r1, r2].find((r) => r.status !== 201)!
    expect([r1.status, r2.status].sort()).toEqual([201, 409])
    // Serialised by pg_advisory_xact_lock, the loser sees the winner and is
    // refused by the application's own check before any INSERT is attempted.
    expect(loser.body.code).toBe('conflict')
    expect(loser.body.message).toMatch(/conflicting appointment|another appointment/)
  })
})

describe('B1.2 — slot-hold → appointment conversion honours the constraint', () => {
  async function holdSlot(s: { startTime: string; endTime: string }) {
    const res = await api(server.url, '/public/slots/hold', {
      body: {
        clinicId: A.clinicId,
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        timezone: 'UTC',
        ...s,
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    return res.body.data.hold.id as string
  }

  async function expectNothingWritten(holdId: string, s: { startTime: string }) {
    const hold = await adminDb.slotHold.findUniqueOrThrow({ where: { id: holdId } })
    expect(hold.status).toBe('ACTIVE')
    expect(hold.convertedToAppointmentId).toBeNull()
    const mine = await adminDb.appointment.count({
      where: { patientId: A.users.patient.id, startTime: new Date(s.startTime) },
    })
    expect(mine).toBe(0)
  }

  it('slot taken by another writer after the hold (visible to the app) → 409, no partial write', async () => {
    const s = slot(40, 9)
    const holdId = await holdSlot(s)
    const auditBefore = await adminDb.auditLog.count({
      where: { clinicId: A.clinicId, action: 'APPOINTMENT_CREATED' },
    })
    // Another clinic patient's appointment lands on the held slot outside the app.
    const other = await adminDb.user.create({
      data: {
        clinicId: A.clinicId,
        name: 'Synthetic Other Patient',
        email: `other.${uid('p')}@example.test`,
        password: 'x',
        role: 'PATIENT',
      },
    })
    await rawInsertAppointment({
      id: uid('taken'),
      clinicId: A.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: other.id,
      ...at(s),
    })

    const res = await api(server.url, '/appointments', {
      token: patient,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        slotHoldId: holdId,
        ...s,
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body.code).toBe('conflict')
    await expectNothingWritten(holdId, s)
    expect(
      await adminDb.auditLog.count({
        where: { clinicId: A.clinicId, action: 'APPOINTMENT_CREATED' },
      })
    ).toBe(auditBefore)
  })

  it('slot taken where only the constraint can see it → the DB rejects, the API still answers a clean 409', async () => {
    // A row for the same provider under another clinic id: RLS hides it from
    // the app role and the app's clinic-scoped checks, so the INSERT itself
    // is what fails — exercising the constraint → 409 mapping.
    const s = slot(41, 9)
    const holdId = await holdSlot(s)
    await rawInsertAppointment({
      id: uid('hidden'),
      clinicId: B.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: B.users.patient.id,
      ...at(s),
    })

    const res = await api(server.url, '/appointments', {
      token: patient,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        slotHoldId: holdId,
        ...s,
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body).toMatchObject({ success: false, code: 'conflict' })
    expect(res.body.message).toMatch(/just booked/)
    expect(JSON.stringify(res.body)).not.toMatch(/23P01|exclusion|tsrange/)
    await expectNothingWritten(holdId, s)
  })

  it('an expired hold is refused with a clear, recoverable error (no 500)', async () => {
    const s = slot(42, 9)
    const holdId = await holdSlot(s)
    await adminDb.slotHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await api(server.url, '/appointments', {
      token: patient,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        slotHoldId: holdId,
        ...s,
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('expired_hold')
  })

  it('a status change that would re-activate a cancelled appointment into a taken slot → 409 and no audit row', async () => {
    const s = slot(43, 9)
    const cancelledId = uid('cxl')
    await rawInsertAppointment({
      id: cancelledId,
      clinicId: A.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: A.users.patient.id,
      ...at(s),
      status: 'CANCELLED',
    })
    await rawInsertAppointment({
      id: uid('live'),
      clinicId: A.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: A.users.patient.id,
      ...at(s),
    })
    const res = await api(server.url, `/appointments/${cancelledId}/status`, {
      method: 'PUT',
      token: adminA,
      body: { status: 'CONFIRMED' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body.code).toBe('conflict')
    expect(
      (await adminDb.appointment.findUniqueOrThrow({ where: { id: cancelledId } })).status
    ).toBe('CANCELLED')
    expect(
      await adminDb.auditLog.count({ where: { entityId: cancelledId, fieldChanged: 'status' } })
    ).toBe(0)
  })

  it('reschedule is atomic: moving into a time overlapping its own old slot works', async () => {
    const s = slot(44, 9, 60)
    const created = await api(server.url, '/appointments', {
      token: frontDesk,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        patientId: A.users.patient.id,
        ...s,
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const oldId = created.body.data.appointment.id as string
    const shifted = new Date(new Date(s.startTime).getTime() + 30 * 60_000)
    const res = await api(server.url, `/appointments/${oldId}/reschedule`, {
      token: frontDesk,
      body: {
        newStartTime: shifted.toISOString(),
        newEndTime: new Date(shifted.getTime() + 60 * 60_000).toISOString(),
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const old = await adminDb.appointment.findUniqueOrThrow({ where: { id: oldId } })
    expect(old.status).toBe('RESCHEDULED')
    expect(old.rescheduledToId).toBe(res.body.data.newAppointment.id)
    const fresh = await adminDb.appointment.findUniqueOrThrow({
      where: { id: res.body.data.newAppointment.id },
    })
    expect(fresh.rescheduledFromId).toBe(oldId)
  })

  it('a reschedule into a taken slot is refused and leaves the original appointment untouched', async () => {
    const s = slot(45, 9)
    const created = await api(server.url, '/appointments', {
      token: frontDesk,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        patientId: A.users.patient.id,
        ...s,
      },
    })
    expect(created.status).toBe(201)
    const oldId = created.body.data.appointment.id as string
    const target = slot(45, 12)
    await rawInsertAppointment({
      id: uid('blk'),
      clinicId: B.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: B.users.patient.id,
      ...at(target),
    })
    const res = await api(server.url, `/appointments/${oldId}/reschedule`, {
      token: frontDesk,
      body: { newStartTime: target.startTime, newEndTime: target.endTime },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    const old = await adminDb.appointment.findUniqueOrThrow({ where: { id: oldId } })
    expect(old.status).toBe('CONFIRMED')
    expect(old.rescheduledToId).toBeNull()
  })
})

describe('B1.3 — set-based getAvailableDatesInRange', () => {
  let C: ClinicFixture
  let providerLA = ''
  let providerIN = ''
  let locLA = ''

  beforeAll(async () => {
    C = await createClinicFixture('sched-range')
    // Fixture provider (UTC, 7 days 00:00–23:59) gets a buffer and bookings.
    await adminDb.provider.update({ where: { id: C.providerId }, data: { bufferMinutes: 15 } })

    const mkProvider = async (key: string, timezone: string, weekdays: number[]) => {
      const user = await adminDb.user.create({
        data: {
          clinicId: C.clinicId,
          name: `Synthetic ${key}`,
          email: `${key}.${uid('u')}@example.test`,
          password: 'x',
          role: 'PROVIDER',
        },
      })
      const loc = await adminDb.location.create({
        data: { clinicId: C.clinicId, name: `Loc ${key}`, timezone, phone: '555-0101' },
      })
      const p = await adminDb.provider.create({
        data: { clinicId: C.clinicId, userId: user.id, firstName: 'Syn', lastName: key },
      })
      await adminDb.providerService.create({ data: { providerId: p.id, serviceId: C.serviceId } })
      await adminDb.providerLocationAssignment.create({
        data: { providerId: p.id, locationId: loc.id, isPrimary: true },
      })
      for (const weekday of weekdays) {
        await adminDb.providerAvailability.create({
          data: {
            providerId: p.id,
            locationId: loc.id,
            weekday,
            startTime: '09:00',
            endTime: '11:00',
          },
        })
      }
      return { id: p.id, locationId: loc.id }
    }
    const la = await mkProvider('la', 'America/Los_Angeles', [1, 3, 5])
    const ind = await mkProvider('in', 'Asia/Kolkata', [2, 4])
    providerLA = la.id
    providerIN = ind.id
    locLA = la.locationId

    const today = DateTime.utc().startOf('day')
    const book = async (
      providerId: string,
      start: DateTime,
      minutes: number,
      status = 'CONFIRMED'
    ) =>
      rawInsertAppointment({
        id: uid('rng'),
        clinicId: C.clinicId,
        providerId,
        serviceId: C.serviceId,
        patientId: C.users.patient.id,
        start: start.toJSDate(),
        end: start.plus({ minutes }).toJSDate(),
        status,
      })

    // Fill every LA slot on the next Monday/Wednesday it works: 09:00–11:00 local.
    for (let d = 1; d <= 14; d++) {
      const local = DateTime.fromISO(today.plus({ days: d }).toISODate(), {
        zone: 'America/Los_Angeles',
      })
      if (local.weekday === 1 || local.weekday === 3) {
        await book(providerLA, local.set({ hour: 9 }), 120)
      }
      const ist = DateTime.fromISO(today.plus({ days: d }).toISODate(), { zone: 'Asia/Kolkata' })
      // Kolkata Tuesday: partial booking (slots remain). Thursday: a cancelled
      // booking that must not block anything.
      if (ist.weekday === 2) await book(providerIN, ist.set({ hour: 9 }), 60)
      if (ist.weekday === 4) await book(providerIN, ist.set({ hour: 9 }), 120, 'CANCELLED')
    }
    // UTC provider: a block crossing midnight, and holds (active + expired).
    await book(C.providerId, today.plus({ days: 5, hours: 22 }), 240)
    await adminDb.slotHold.createMany({
      data: [
        {
          clinicId: C.clinicId,
          providerId: C.providerId,
          serviceId: C.serviceId,
          startTime: today.plus({ days: 6, hours: 10 }).toJSDate(),
          endTime: today.plus({ days: 6, hours: 10, minutes: 30 }).toJSDate(),
          expiresAt: new Date(Date.now() + 10 * 60_000),
          status: 'ACTIVE',
        },
        {
          clinicId: C.clinicId,
          providerId: C.providerId,
          serviceId: C.serviceId,
          startTime: today.plus({ days: 6, hours: 11 }).toJSDate(),
          endTime: today.plus({ days: 6, hours: 11, minutes: 30 }).toJSDate(),
          expiresAt: new Date(Date.now() - 60_000),
          status: 'ACTIVE',
        },
      ],
    })
    // Unavailability: one full day and one partial day for the UTC provider.
    await adminDb.providerUnavailability.createMany({
      data: [
        { providerId: C.providerId, date: today.plus({ days: 8 }).toJSDate() },
        {
          providerId: C.providerId,
          date: today.plus({ days: 9 }).toJSDate(),
          startTime: '00:00',
          endTime: '12:00',
        },
      ],
    })
  })

  const window = (days: number) => {
    const start = DateTime.utc().plus({ days: 1 })
    return { startDate: start.toISODate(), endDate: start.plus({ days: days - 1 }).toISODate() }
  }
  const inBypass = <T>(fn: () => Promise<T>) => withTenantBypass('scheduling-int-test', fn)

  it('matches the pre-B1.3 implementation exactly (all providers, single provider, with location)', async () => {
    const w = window(21)
    const variants = [
      { clinicId: C.clinicId, serviceId: C.serviceId, ...w },
      { clinicId: C.clinicId, serviceId: C.serviceId, providerId: providerLA, ...w },
      { clinicId: C.clinicId, serviceId: C.serviceId, providerId: providerIN, ...w },
      { clinicId: C.clinicId, serviceId: C.serviceId, providerId: C.providerId, ...w },
      { clinicId: C.clinicId, serviceId: C.serviceId, locationId: locLA, ...w },
    ]
    for (const v of variants) {
      const [legacy, current] = await inBypass(() =>
        Promise.all([
          legacyGetAvailableDatesInRange(v),
          availabilityService.getAvailableDatesInRange(v),
        ])
      )
      expect(current, JSON.stringify(v)).toEqual(legacy)
    }
    // The fixture is not trivial: LA is fully booked on its Mon/Wed, so the
    // single-provider answer has gaps.
    const laOnly = await inBypass(() =>
      availabilityService.getAvailableDatesInRange({
        clinicId: C.clinicId,
        serviceId: C.serviceId,
        providerId: providerLA,
        ...w,
      })
    )
    expect(laOnly.length).toBeGreaterThan(0)
    expect(laOnly.length).toBeLessThan(21)
  })

  it('getAvailableSlots (now built on the same computation) returns the same slots as before, day by day', async () => {
    const start = DateTime.utc().plus({ days: 1 })
    for (let d = 0; d < 14; d++) {
      const date = start.plus({ days: d }).toISODate()
      for (const providerId of [C.providerId, providerLA, providerIN]) {
        const params = {
          providerId,
          serviceId: C.serviceId,
          serviceDurationMinutes: 30,
          date,
          clinicId: C.clinicId,
        }
        const [legacy, current] = await inBypass(() =>
          Promise.all([
            legacyGetAvailableSlots(params),
            availabilityService.getAvailableSlots(params),
          ])
        )
        expect(current, `${providerId} ${date}`).toEqual(legacy)
      }
    }
  })

  it('issues a bounded number of queries, independent of the window length (not N×M)', async () => {
    const countOps = async (fn: () => Promise<unknown>) => {
      let n = 0
      const off = onPrismaOperation(() => void n++)
      try {
        await inBypass(fn as () => Promise<unknown>)
      } finally {
        off()
      }
      return n
    }
    const range = (days: number) => () =>
      availabilityService.getAvailableDatesInRange({
        clinicId: C.clinicId,
        serviceId: C.serviceId,
        ...window(days),
      })
    const legacyRange = (days: number) => () =>
      legacyGetAvailableDatesInRange({
        clinicId: C.clinicId,
        serviceId: C.serviceId,
        ...window(days),
      })

    const week = await countOps(range(7))
    const quarter = await countOps(range(90))
    // service + providers + appointments + holds + unavailabilities
    expect(week).toBeLessThanOrEqual(5)
    expect(quarter).toBe(week)

    const legacyWeek = await countOps(legacyRange(7))
    const legacyQuarter = await countOps(legacyRange(90))
    expect(legacyQuarter).toBeGreaterThan(legacyWeek)
    expect(legacyQuarter).toBeGreaterThan(quarter * 10)
  })

  it('the public summary endpoint serves the set-based answer', async () => {
    const w = window(14)
    const res = await api(
      server.url,
      `/public/availability/summary?clinicId=${C.clinicId}&serviceId=${C.serviceId}&startDate=${w.startDate}&endDate=${w.endDate}`
    )
    expect(res.status).toBe(200)
    const expected = await inBypass(() =>
      legacyGetAvailableDatesInRange({ clinicId: C.clinicId, serviceId: C.serviceId, ...w })
    )
    expect(res.body.data.availableDates).toEqual(expected)
  })

  it('an inverted or invalid window returns no dates instead of erroring', async () => {
    const res = await inBypass(() =>
      availabilityService.getAvailableDatesInRange({
        clinicId: C.clinicId,
        serviceId: C.serviceId,
        startDate: '2026-12-10',
        endDate: '2026-12-01',
      })
    )
    expect(res).toEqual([])
  })
})

describe('B1.4 — booking race', () => {
  it('ten concurrent bookings of one slot by different patients → exactly one 201, nine 409', async () => {
    const s = slot(50, 9)
    const patients = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const u = await adminDb.user.create({
          data: {
            clinicId: A.clinicId,
            name: `Synthetic Racer ${i}`,
            email: `racer${i}.${uid('r')}@example.test`,
            password: 'x',
            role: 'PATIENT',
          },
        })
        return u.id
      })
    )
    const results = await Promise.all(
      patients.map((patientId) =>
        api(server.url, '/appointments', {
          token: frontDesk,
          body: {
            providerId: A.providerId,
            serviceId: A.serviceId,
            locationId: A.locationId,
            patientId,
            ...s,
          },
        })
      )
    )
    const codes = results.map((r) => r.status)
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.filter((c) => c === 409)).toHaveLength(9)
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('conflict')
    const live = await adminDb.appointment.count({
      where: {
        providerId: A.providerId,
        startTime: new Date(s.startTime),
        status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
      },
    })
    expect(live).toBe(1)
  })

  it('without the app (no advisory lock): concurrent raw INSERTs → the DB admits exactly one', async () => {
    const s = slot(51, 9)
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        rawInsertAppointment({
          id: uid('raw'),
          clinicId: A.clinicId,
          providerId: A.providerId,
          serviceId: A.serviceId,
          patientId: A.users.patient.id,
          ...at(s),
        })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(7)
    for (const r of rejected) expect(errorText(r.reason)).toMatch(/23P01|no_overlap/)
  })
})

describe('Recurring series cancel (F1.2 backend)', () => {
  let seriesId = ''

  it('front desk creates a weekly series, then cancels every upcoming visit of it in one action', async () => {
    const first = slot(60, 15)
    const created = await api(server.url, '/appointments/recurring', {
      token: frontDesk,
      body: {
        providerId: A.providerId,
        serviceId: A.serviceId,
        locationId: A.locationId,
        patientId: A.users.patient.id,
        ...first,
        frequency: 'WEEKLY',
        numberOfSessions: 4,
      },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const appts = created.body.data.appointments as { id: string; recurringSeriesId: string }[]
    expect(appts).toHaveLength(4)
    seriesId = appts[0]!.recurringSeriesId
    expect(seriesId).toBeTruthy()

    const res = await api(server.url, `/appointments/recurring/${seriesId}/cancel`, {
      token: frontDesk,
      body: { reason: 'Series ended early' },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.cancelledAppointmentIds).toHaveLength(4)
    const statuses = await adminDb.appointment.findMany({
      where: { recurringSeriesId: seriesId },
      select: { status: true },
    })
    expect(statuses.every((a) => a.status === 'CANCELLED')).toBe(true)
    expect(
      await adminDb.auditLog.count({
        where: { entityId: seriesId, action: 'RECURRING_SERIES_CANCELLED' },
      })
    ).toBe(1)
  })

  it('a patient cannot cancel a series (403) and another clinic cannot see it (404)', async () => {
    const asPatient = await api(server.url, `/appointments/recurring/${seriesId}/cancel`, {
      token: patient,
      body: {},
    })
    expect(asPatient.status).toBe(403)
    const otherClinic = await api(server.url, `/appointments/recurring/${seriesId}/cancel`, {
      token: frontDeskB,
      body: {},
    })
    expect(otherClinic.status).toBe(404)
  })

  it('appointment detail carries the service cancellation policy (for the F1.3 UI)', async () => {
    await adminDb.service.update({
      where: { id: A.serviceId },
      data: {
        cancellationWindowHours: 24,
        cancellationFeeType: 'FIXED',
        cancellationFeeValue: new Prisma.Decimal(25),
      },
    })
    const res = await api(server.url, `/appointments/${A.appointmentId}`, { token: patient })
    expect(res.status).toBe(200)
    expect(res.body.data.appointment.service).toMatchObject({
      cancellationWindowHours: 24,
      cancellationFeeType: 'FIXED',
    })
    expect(Number(res.body.data.appointment.service.cancellationFeeValue)).toBe(25)
  })
})

/**
 * CTO-34: more than one location. Add, edit and remove locations (US address
 * rules, CTO-22); the application's location count follows them; a solo
 * provider works at every new location; hours set for a location use that
 * location's timezone.
 */
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

let server: TestServer
let fx: ClinicFixture
let owner = ''

beforeAll(async () => {
  server = await startServer()
  fx = await createClinicFixture('locs')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  await adminDb.clinicProfile.create({
    data: {
      clinicId: fx.clinicId,
      legalName: 'Synthetic Locations LLC',
      practiceType: 'MEDICAL_PRACTICE',
      locationCount: 1,
      primaryContactName: 'Olivia',
      primaryContactEmail: 'olivia@example.test',
      federalTaxId: 'fle-test-placeholder',
    },
  })
})
afterAll(() => server.close())

describe('locations', () => {
  it('add, edit and remove; the count follows; US rules apply', async () => {
    const bad = await api(server.url, '/locations', {
      token: owner,
      body: { name: 'Bad ZIP', postalCode: '123', state: 'CA', timezone: 'America/Los_Angeles' },
    })
    expect(bad.status).toBe(400)
    expect(
      (
        await api(server.url, '/locations', {
          token: owner,
          body: { name: 'Bad TZ', timezone: 'Mars/Olympus' },
        })
      ).status
    ).toBe(400)

    const west = await api(server.url, '/locations', {
      token: owner,
      body: {
        name: 'West Office',
        addressLine1: '1 Ocean Ave',
        city: 'Santa Monica',
        state: 'ca',
        postalCode: '90401',
        timezone: 'America/Los_Angeles',
      },
    })
    expect(west.status, JSON.stringify(west.body)).toBe(201)
    const westId = west.body.data.location.id as string
    expect(west.body.data.location.state).toBe('CA')
    expect(
      (await adminDb.clinicProfile.findUniqueOrThrow({ where: { clinicId: fx.clinicId } }))
        .locationCount
    ).toBe(2)
    // The clinic's one provider works there too.
    expect(
      await adminDb.providerLocationAssignment.count({
        where: { providerId: fx.providerId, locationId: westId },
      })
    ).toBe(1)

    const edited = await api(server.url, `/locations/${westId}`, {
      token: owner,
      method: 'PATCH',
      body: { name: 'West Clinic' },
    })
    expect(edited.status).toBe(200)

    // Not while something is booked there.
    const start = DateTime.now()
      .plus({ days: 5 })
      .set({ hour: 10, minute: 0, second: 0, millisecond: 0 })
    const appt = await adminDb.appointment.create({
      data: {
        clinicId: fx.clinicId,
        providerId: fx.providerId,
        serviceId: fx.serviceId,
        patientId: fx.users.patient.id,
        locationId: westId,
        startTime: start.toJSDate(),
        endTime: start.plus({ minutes: 30 }).toJSDate(),
        priceAtBooking: new Prisma.Decimal(100),
        status: 'CONFIRMED',
      },
    })
    const blocked = await api(server.url, `/locations/${westId}`, {
      token: owner,
      method: 'DELETE',
    })
    expect(blocked.status).toBe(409)
    expect(blocked.body.message).toMatch(/upcoming appointment/)
    await adminDb.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELLED' } })

    const removed = await api(server.url, `/locations/${westId}`, {
      token: owner,
      method: 'DELETE',
    })
    expect(removed.status, JSON.stringify(removed.body)).toBe(200)
    expect((await adminDb.location.findUniqueOrThrow({ where: { id: westId } })).isActive).toBe(
      false
    )
    expect(
      (await adminDb.clinicProfile.findUniqueOrThrow({ where: { clinicId: fx.clinicId } }))
        .locationCount
    ).toBe(1)
    // The last location can't go; staff can't remove; another clinic gets 404.
    expect(
      (await api(server.url, `/locations/${fx.locationId}`, { token: owner, method: 'DELETE' }))
        .status
    ).toBe(409)
    const frontDesk = (await login(server.url, fx.users.frontDesk.email)).accessToken
    expect(
      (await api(server.url, `/locations/${fx.locationId}`, { token: frontDesk, method: 'DELETE' }))
        .status
    ).toBe(403)
    const other = await createClinicFixture('locs-other')
    const otherOwner = (await login(server.url, other.users.admin.email)).accessToken
    expect(
      (
        await api(server.url, `/locations/${fx.locationId}`, {
          token: otherOwner,
          method: 'DELETE',
        })
      ).status
    ).toBe(404)
  })

  it("hours set for a location follow that location's timezone", async () => {
    const east = await api(server.url, '/locations', {
      token: owner,
      body: { name: 'East Office', state: 'NY', postalCode: '10001', timezone: 'America/New_York' },
    })
    const eastId = east.body.data.location.id as string
    const date = DateTime.now().setZone('America/New_York').plus({ days: 7 })
    const weekday = date.weekday % 7
    // Only a 09:00 to 10:00 window at the East office.
    await adminDb.providerAvailability.deleteMany({ where: { providerId: fx.providerId } })
    const hours = await api(server.url, `/providers/${fx.providerId}/availability`, {
      token: owner,
      body: { locationId: eastId, weekday, startTime: '09:00', endTime: '10:00' },
    })
    expect(hours.status, JSON.stringify(hours.body)).toBe(201)
    expect(hours.body.data.availability.locationId).toBe(eastId)

    const slots = await api(
      server.url,
      `/appointments/availability?serviceId=${fx.serviceId}&providerId=${fx.providerId}&locationId=${eastId}&date=${date.toISODate()}`,
      { token: owner }
    )
    expect(slots.status, JSON.stringify(slots.body)).toBe(200)
    const first = slots.body.data.slots[0]
    expect(first).toBeTruthy()
    // 09:00 in New York, whatever the server's clock.
    expect(DateTime.fromISO(first.start).setZone('America/New_York').toFormat('HH:mm')).toBe(
      '09:00'
    )
    // A location the provider doesn't work at is refused.
    const nowhere = await adminDb.location.create({
      data: { clinicId: fx.clinicId, name: 'Unassigned', timezone: 'America/Chicago' },
    })
    await adminDb.providerLocationAssignment.deleteMany({ where: { locationId: nowhere.id } })
    expect(
      (
        await api(server.url, `/providers/${fx.providerId}/availability`, {
          token: owner,
          body: { locationId: nowhere.id, weekday, startTime: '09:00', endTime: '10:00' },
        })
      ).status
    ).toBe(400)
  })
})

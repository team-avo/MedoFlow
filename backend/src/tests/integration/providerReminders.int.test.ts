/**
 * CTO-30: providers are reminded when an appointment starts within 10
 * minutes: a bell notification (red dot) and a Command Center card, plus an
 * e-mail when SMTP is configured. No PHI beyond the time and a link.
 */
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import { withTenantBypass } from '../../config/tenantContext'
import {
  REMINDER_PAYLOAD_KEYS,
  reminderPayload,
  sendStartingSoonReminders,
} from '../../services/providerReminderService'

let server: TestServer
let fx: ClinicFixture
let provider = ''

beforeAll(async () => {
  server = await startServer()
  fx = await createClinicFixture('remind')
  provider = (await login(server.url, fx.users.provider.email)).accessToken
})
afterAll(() => server.close())

const run = (now?: Date) => withTenantBypass('test:reminders', () => sendStartingSoonReminders(now))

describe('starting-soon reminders', () => {
  it('one PHI-free notification per appointment, idempotent, read by its provider only', async () => {
    const start = new Date(Date.now() + 5 * 60_000)
    const appt = await adminDb.appointment.create({
      data: {
        clinicId: fx.clinicId,
        providerId: fx.providerId,
        serviceId: fx.serviceId,
        patientId: fx.users.patient.id,
        locationId: fx.locationId,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        priceAtBooking: new Prisma.Decimal(100),
        status: 'CONFIRMED',
        timezone: 'America/Chicago',
      },
    })
    expect(await run()).toBeGreaterThanOrEqual(1)
    expect(await run()).toBe(0) // never twice

    const res = await api(server.url, '/notifications', { token: provider })
    expect(res.status).toBe(200)
    expect(res.body.data.unread).toBeGreaterThanOrEqual(1)
    const n = res.body.data.notifications.find(
      (x: { appointmentId: string }) => x.appointmentId === appt.id
    )
    expect(n.title).toMatch(/^Your \d{1,2}:\d{2} (AM|PM) appointment starts soon$/)
    expect(n.link).toBe(`/dashboard/provider/appointments/${appt.id}/consultation?autostart=1`)
    // Nothing about the patient or the visit.
    const patient = await adminDb.user.findUniqueOrThrow({ where: { id: fx.users.patient.id } })
    expect(JSON.stringify(res.body)).not.toContain(patient.name)
    expect(JSON.stringify(res.body)).not.toContain(patient.email)

    // Other staff see none of it; the provider marks it read.
    const frontDesk = (await login(server.url, fx.users.frontDesk.email)).accessToken
    const theirs = await api(server.url, '/notifications', { token: frontDesk })
    expect(theirs.body.data.notifications).toHaveLength(0)
    expect(
      (await api(server.url, `/notifications/${n.id}/read`, { token: frontDesk, body: {} })).body
        .data.updated
    ).toBe(0)
    await api(server.url, `/notifications/${n.id}/read`, { token: provider, body: {} })
    const after = await api(server.url, '/notifications', { token: provider })
    expect(
      after.body.data.notifications.find((x: { id: string }) => x.id === n.id).readAt
    ).not.toBeNull()
  })

  it('only within 10 minutes, only confirmed', async () => {
    const later = new Date(Date.now() + 40 * 60_000)
    const appt = await adminDb.appointment.create({
      data: {
        clinicId: fx.clinicId,
        providerId: fx.providerId,
        serviceId: fx.serviceId,
        patientId: fx.users.patient.id,
        locationId: fx.locationId,
        startTime: later,
        endTime: new Date(later.getTime() + 30 * 60_000),
        priceAtBooking: new Prisma.Decimal(100),
        status: 'CONFIRMED',
      },
    })
    await run()
    expect(await adminDb.notification.count({ where: { appointmentId: appt.id } })).toBe(0)
    await run(new Date(later.getTime() - 9 * 60_000))
    expect(await adminDb.notification.count({ where: { appointmentId: appt.id } })).toBe(1)
  })

  it('the payload is an allow-list of ids, a time and a generic title', () => {
    const p = reminderPayload({
      id: 'a1',
      clinicId: 'c1',
      startTime: new Date('2026-11-12T16:30:00.000Z'),
      timezone: 'America/New_York',
      providerUserId: 'u1',
    })
    expect(Object.keys(p).sort()).toEqual([...REMINDER_PAYLOAD_KEYS].sort())
    expect(p.title).toBe('Your 11:30 AM appointment starts soon')
  })
})

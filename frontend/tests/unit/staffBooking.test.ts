/** CTO-24: who may book from the dashboard, and the "Walk-in, now" time. */
import { describe, expect, it } from 'vitest'
import { canBookAppointments, walkInStart } from '@/lib/staffBookingApi'

describe('canBookAppointments', () => {
  it('owner and front desk always; custom roles with appointments.create; never providers or patients', () => {
    expect(canBookAppointments({ role: 'SUPER_ADMIN' })).toBe(true)
    expect(canBookAppointments({ role: 'FRONT_DESK' })).toBe(true)
    expect(canBookAppointments({ role: 'PROVIDER' })).toBe(false)
    expect(canBookAppointments({ role: 'PATIENT' })).toBe(false)
    expect(canBookAppointments({ role: 'STAFF', permissions: ['appointments.view'] })).toBe(false)
    expect(
      canBookAppointments({ role: 'STAFF', customRole: { permissions: ['appointments.create'] } })
    ).toBe(true)
    expect(canBookAppointments({ role: 'STAFF', permissions: ['*'] })).toBe(true)
    expect(canBookAppointments(null)).toBe(false)
  })
})

describe('walkInStart', () => {
  const now = new Date('2026-11-12T15:02:00.000Z')
  const s = (start: string, end: string) => ({ start, end, locationId: 'loc-1' })

  it('takes the first open slot from now on', () => {
    const slots = [
      s('2026-11-12T14:00:00.000Z', '2026-11-12T14:30:00.000Z'), // past
      s('2026-11-12T15:30:00.000Z', '2026-11-12T16:00:00.000Z'),
      s('2026-11-12T15:00:00.000Z', '2026-11-12T15:30:00.000Z'), // just started: still fine
    ]
    expect(walkInStart(slots, 30, now)).toEqual({
      startTime: '2026-11-12T15:00:00.000Z',
      endTime: '2026-11-12T15:30:00.000Z',
      locationId: 'loc-1',
      fromSlot: true,
    })
  })

  it('with nothing left today, books now (rounded up to 5 minutes) for the service length', () => {
    expect(walkInStart([], 45, now)).toEqual({
      startTime: '2026-11-12T15:05:00.000Z',
      endTime: '2026-11-12T15:50:00.000Z',
      locationId: null,
      fromSlot: false,
    })
  })
})

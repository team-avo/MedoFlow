/**
 * lib/timezone — one display zone for appointment times: the configured
 * NEXT_PUBLIC_DISPLAY_TIMEZONE when valid, otherwise the system zone.
 * Each case pins the zone so the suite passes on any machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDaysToDateKey,
  dateKeyInZone,
  displayTimeZoneLabel,
  formatClockShort,
  formatDateKey,
  formatDateTime,
  formatLongDate,
  formatSlotTime,
  formatTime,
  formatTimeRange,
  getDisplayTimeZone,
  systemTimeZone,
  zonedParts,
} from '@/lib/timezone'

const SLOT = '2026-10-26T15:00:00.000Z' // 08:00 Los Angeles, 20:30 Kolkata

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getDisplayTimeZone', () => {
  it('uses the system zone when the env var is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', '')
    expect(getDisplayTimeZone()).toBe(systemTimeZone())
    expect(systemTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('uses a valid configured zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Asia/Kolkata')
    expect(getDisplayTimeZone()).toBe('Asia/Kolkata')
  })

  it('falls back to the system zone for an invalid value', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Mars/Olympus_Mons')
    expect(getDisplayTimeZone()).toBe(systemTimeZone())
  })

  it('labels the zone with a readable name, also for legacy IANA aliases', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Asia/Calcutta')
    expect(displayTimeZoneLabel()).toBe('India Standard Time')
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'America/Los_Angeles')
    expect(displayTimeZoneLabel(new Date('2026-01-15T12:00:00Z'))).toBe('Pacific Standard Time')
  })
})

describe('formatting follows the display zone', () => {
  it('the same instant reads differently per zone, identically everywhere for one zone', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Asia/Kolkata')
    expect(formatTime(SLOT)).toBe('8:30 PM')
    expect(formatTimeRange(SLOT, '2026-10-26T16:00:00.000Z')).toBe('8:30 PM – 9:30 PM')
    expect(formatLongDate(SLOT)).toBe('Monday, October 26')
    expect(formatClockShort(SLOT)).toBe('8:30')

    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'America/Los_Angeles')
    expect(formatTime(SLOT)).toBe('8:00 AM')
    expect(formatDateTime(SLOT)).toBe('Oct 26, 2026, 8:00 AM')
  })

  it('accepts Date objects and returns "" for invalid input', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'UTC')
    expect(formatTime(new Date(SLOT))).toBe('3:00 PM')
    expect(formatTime('not a date')).toBe('')
  })
})

describe('zonedParts / dateKeyInZone', () => {
  it('reports wall-clock fields in the display zone, across midnight', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Asia/Kolkata')
    const lateLa = '2026-10-26T20:00:00.000Z' // 13:00 LA Mon = 01:30 Kolkata Tue
    expect(zonedParts(lateLa)).toEqual({
      year: 2026,
      month: 10,
      day: 27,
      weekday: 2,
      hour: 1,
      minute: 30,
    })
    expect(dateKeyInZone(lateLa)).toBe('2026-10-27')

    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'America/Los_Angeles')
    expect(dateKeyInZone(lateLa)).toBe('2026-10-26')
    expect(zonedParts(lateLa).hour).toBe(13)
  })

  it('midnight is hour 0, not 24', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'UTC')
    expect(zonedParts('2026-10-26T00:15:00.000Z').hour).toBe(0)
  })
})

describe('formatSlotTime', () => {
  it('adds the date only when the slot falls on another day than the picked clinic day', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Asia/Kolkata')
    expect(formatSlotTime(SLOT, '2026-10-26')).toBe('8:30 PM')
    expect(formatSlotTime('2026-10-26T20:00:00.000Z', '2026-10-26')).toBe('1:30 AM · Tue, Oct 27')
    expect(formatSlotTime(SLOT)).toBe('8:30 PM')
  })
})

describe('date keys (clinic calendar days) never shift with the zone', () => {
  it('formats and steps yyyy-MM-dd keys as plain calendar dates', () => {
    vi.stubEnv('NEXT_PUBLIC_DISPLAY_TIMEZONE', 'Pacific/Kiritimati') // UTC+14
    expect(formatDateKey('2026-10-26', { weekday: 'short', day: 'numeric' })).toBe('26 Mon')
    expect(addDaysToDateKey('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToDateKey('2026-03-08', 1)).toBe('2026-03-09') // US DST change
  })
})

/**
 * Demo stocking: where Visits A and B land (prisma/demoStock.nextFreeSlots),
 * and the slug helper shared with the site builder. Pure functions.
 */
import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { nextFreeSlots } from '../../prisma/demoStock'
import { freeSlug, slugify } from '../../prisma/demoWorld'
import { slugify as siteSlugify } from '../site/services/slugService'

const TZ = 'America/Chicago'
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate()
const fmt = (ts: DateTime[]) => ts.map((t) => t.toFormat('ccc HH:mm'))
const base = { timezone: TZ, durationMin: 45, noticeMin: 60, busy: [], count: 2 }

describe('nextFreeSlots', () => {
  it('opens at 09:00 when the notice ends before opening', () => {
    // Monday 2026-11-16 07:00
    expect(fmt(nextFreeSlots({ ...base, now: at('2026-11-16T07:00') }))).toEqual([
      'Mon 09:00',
      'Mon 09:45',
    ])
  })

  it('keeps the notice period and the 15-minute grid', () => {
    expect(fmt(nextFreeSlots({ ...base, now: at('2026-11-16T10:05') }))).toEqual([
      'Mon 11:15',
      'Mon 12:00',
    ])
  })

  it('never ends after 17:00 and skips the weekend', () => {
    // Friday 15:10 + 60 min notice → 16:15 is the last 45-minute start.
    expect(fmt(nextFreeSlots({ ...base, now: at('2026-11-20T15:10') }))).toEqual([
      'Fri 16:15',
      'Mon 09:00',
    ])
    expect(fmt(nextFreeSlots({ ...base, now: at('2026-11-21T12:00') }))).toEqual([
      'Mon 09:00',
      'Mon 09:45',
    ])
  })

  it('steps around booked appointments', () => {
    const busy = [{ start: at('2026-11-16T09:30'), end: at('2026-11-16T10:30') }]
    expect(fmt(nextFreeSlots({ ...base, busy, now: at('2026-11-16T07:00') }))).toEqual([
      'Mon 10:30',
      'Mon 11:15',
    ])
  })
})

describe('demo slugs', () => {
  it('follow the site builder rules', () => {
    for (const name of [
      'Sleep & Stress Support',
      'Whey Isolate Protein (Unflavored)',
      'Dr. Évelyn Chen',
    ]) {
      expect(slugify(name)).toBe(siteSlugify(name))
    }
  })

  it('freeSlug suffixes a taken slug', () => {
    const taken = new Set(['arnica-gel'])
    expect(freeSlug('Arnica Gel', taken)).toBe('arnica-gel-2')
    expect(freeSlug('Arnica Gel', taken)).toBe('arnica-gel-3')
  })
})

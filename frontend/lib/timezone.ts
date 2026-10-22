/**
 * One display time zone for every appointment, slot and visit time in the UI.
 *
 * Set NEXT_PUBLIC_DISPLAY_TIMEZONE to an IANA zone (e.g. "America/Los_Angeles")
 * to pin it for a deployment. Unset — the default — it is the viewer's system
 * zone. The API always speaks UTC ISO strings; clinic opening hours are defined
 * in the clinic location's zone on the server. All formatting goes through
 * Intl with one locale, so every screen shows the same slot the same way.
 */

export const DISPLAY_LOCALE = 'en-US'

type DateInput = Date | string | number

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** The configured zone if valid, otherwise the system zone. */
export function getDisplayTimeZone(): string {
  const configured = process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE?.trim()
  if (configured && isValidTimeZone(configured)) return configured
  return systemTimeZone()
}

/**
 * A readable name for the display zone, e.g. "India Standard Time" or
 * "Pacific Daylight Time" (IANA ids can be legacy aliases such as
 * "Asia/Calcutta", which read oddly in the UI).
 */
export function displayTimeZoneLabel(at: Date = new Date()): string {
  const timeZone = getDisplayTimeZone()
  const name = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone, timeZoneName: 'long' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value
  return name || timeZone
}

const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d))

function fmt(d: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(d)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    ...options,
    timeZone: getDisplayTimeZone(),
  }).format(date)
}

/** "9:30 AM" */
export const formatTime = (d: DateInput) => fmt(d, { hour: 'numeric', minute: '2-digit' })

/** "9:30 AM – 10:30 AM" */
export const formatTimeRange = (start: DateInput, end: DateInput) =>
  `${formatTime(start)} – ${formatTime(end)}`

/** "Oct 26, 2026" */
export const formatDate = (d: DateInput) => fmt(d, { dateStyle: 'medium' })

/** "Oct 26, 2026, 9:30 AM" */
export const formatDateTime = (d: DateInput) => fmt(d, { dateStyle: 'medium', timeStyle: 'short' })

/** "Mon, Oct 26" */
export const formatWeekdayDate = (d: DateInput) =>
  fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })

/** "Monday, October 26" */
export const formatLongDate = (d: DateInput) =>
  fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })

/** "Mon, Oct 26, 9:30 AM" */
export const formatShortDateTime = (d: DateInput) =>
  fmt(d, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "Monday, Oct 26" */
export const formatDayHeading = (d: DateInput) =>
  fmt(d, { weekday: 'long', month: 'short', day: 'numeric' })

/** "9:30" (no AM/PM) — for compact calendar blocks. */
export function formatClockShort(d: DateInput): string {
  const p = zonedParts(d)
  return `${p.hour % 12 || 12}:${String(p.minute).padStart(2, '0')}`
}

/** "Monday, October 26, 9:30 AM" */
export const formatLongDateTime = (d: DateInput) =>
  fmt(d, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export interface ZonedParts {
  year: number
  month: number // 1–12
  day: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  hour: number // 0–23
  minute: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** Calendar fields of an instant in the display zone. */
export function zonedParts(d: DateInput): ZonedParts {
  const parts = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: getDisplayTimeZone(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(toDate(d))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  }
}

/** "yyyy-MM-dd" of an instant in the display zone. */
export function dateKeyInZone(d: DateInput = new Date()): string {
  const p = zonedParts(d)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** `key` (yyyy-MM-dd) plus `days` calendar days, as yyyy-MM-dd. */
export function addDaysToDateKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Format a calendar date key (yyyy-MM-dd) itself — no zone conversion, so
 * "2026-10-26" is always Oct 26 whatever the display zone.
 */
export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { ...options, timeZone: 'UTC' }).format(
    new Date(`${key}T12:00:00Z`)
  )
}

/**
 * A slot's time for a slot list. Availability is requested per clinic
 * calendar day (`pickedDate`, yyyy-MM-dd); when the slot falls on another
 * date in the display zone — e.g. Los Angeles afternoons seen from India —
 * the date is added so the list is never ambiguous: "12:30 AM · Tue, Oct 27".
 */
export function formatSlotTime(start: DateInput, pickedDate?: string | null): string {
  const time = formatTime(start)
  if (!pickedDate || dateKeyInZone(start) === pickedDate) return time
  return `${time} · ${formatWeekdayDate(start)}`
}

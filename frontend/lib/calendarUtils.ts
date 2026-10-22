import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  parseISO,
  isSameDay,
  setHours,
  setMinutes,
  differenceInMinutes,
} from 'date-fns'
import { zonedParts } from '@/lib/timezone'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const SLOT_START_HOUR = 6
export const SLOT_END_HOUR = 21
export const SLOT_INTERVAL_MINUTES = 30

export function getWeekRange(date: Date): { start: Date; end: Date } {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })
  return { start, end }
}

export function getNextWeek(date: Date): Date {
  return addWeeks(date, 1)
}

export function getPrevWeek(date: Date): Date {
  return subWeeks(date, 1)
}

export function formatWeekLabel(start: Date, end: Date): string {
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
}

export function getTimeSlots(): Date[] {
  const slots: Date[] = []
  const base = new Date(2000, 0, 1)
  for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h++) {
    for (let m = 0; m < 60; m += SLOT_INTERVAL_MINUTES) {
      slots.push(setMinutes(setHours(base, h), m))
    }
  }
  return slots
}

export function getSlotIndex(date: Date): number {
  const base = setMinutes(setHours(new Date(date), SLOT_START_HOUR), 0)
  return differenceInMinutes(date, base) / SLOT_INTERVAL_MINUTES
}

/** Mon = 0 … Sun = 6, by the appointment's weekday in the display zone. */
export function getDayColumn(date: Date): number {
  const d = zonedParts(date).weekday
  return d === 0 ? 6 : d - 1
}

export function getAppointmentPosition(
  startTime: string,
  endTime: string
): { top: number; height: number } {
  const start = typeof startTime === 'string' ? parseISO(startTime) : new Date(startTime)
  const end = typeof endTime === 'string' ? parseISO(endTime) : new Date(endTime)
  // Clock time in the display zone (lib/timezone), not the runtime's local zone.
  const { hour, minute } = zonedParts(start)
  const minutesFromGridStart = hour * 60 + minute - SLOT_START_HOUR * 60
  const top = Math.max(0, minutesFromGridStart / SLOT_INTERVAL_MINUTES)
  const height = Math.max(1, differenceInMinutes(end, start) / SLOT_INTERVAL_MINUTES)
  return { top, height }
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export function getWeekDates(start: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    dates.push(d)
  }
  return dates
}

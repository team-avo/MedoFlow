import { DateTime } from 'luxon'
import type { Prisma, ProviderUnavailability } from '@prisma/client'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import { clinicScope } from '../config/tenantContext'
import type { BlockedInterval, SchedulingSlot } from './schedulingCore'
import {
  buildCandidateSlots,
  DEFAULT_SLOT_STEP_MINUTES,
  getDateWindow,
  MIN_APPOINTMENT_DURATION_MINUTES,
} from './schedulingCore'

const CANCELLED_STATUS = 'CANCELLED'
const RESCHEDULED_STATUS = 'RESCHEDULED'
const ONLINE_LOCATION_NAME = 'Online'

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { hours: h ?? 0, minutes: m ?? 0 }
}

function timeToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function timeStringToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTime(timeStr)
  return hours * 60 + minutes
}

function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date)
  result.setMinutes(result.getMinutes() + minutes)
  return result
}

function getTimeWindowMinutes(startTime: string, endTime: string): number {
  return timeStringToMinutes(endTime) - timeStringToMinutes(startTime)
}

function assertValidAvailabilityWindow(startTime: string, endTime: string) {
  const windowMinutes = getTimeWindowMinutes(startTime, endTime)

  if (windowMinutes <= 0) {
    const err = new Error('End time must be after start time') as ApiError
    err.statusCode = 400
    throw err
  }

  if (windowMinutes < MIN_APPOINTMENT_DURATION_MINUTES) {
    const err = new Error(
      `Availability windows must be at least ${MIN_APPOINTMENT_DURATION_MINUTES} minutes`
    ) as ApiError
    err.statusCode = 400
    throw err
  }
}

async function ensureOnlineLocation(providerId: string, clinicId: string) {
  let location = await prisma.location.findFirst({
    where: {
      clinicId,
      isActive: true,
      name: { equals: ONLINE_LOCATION_NAME, mode: 'insensitive' },
    },
    select: { id: true, timezone: true },
  })

  if (!location) {
    const fallbackLocation = await prisma.location.findFirst({
      where: { clinicId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { timezone: true },
    })

    location = await prisma.location.create({
      data: {
        clinicId,
        name: ONLINE_LOCATION_NAME,
        address: 'Online',
        timezone: fallbackLocation?.timezone ?? 'UTC',
      },
      select: { id: true, timezone: true },
    })
  }

  const existingAssignment = await prisma.providerLocationAssignment.findFirst({
    where: { providerId, locationId: location.id },
    select: { id: true },
  })

  if (!existingAssignment) {
    const hasAssignments = await prisma.providerLocationAssignment.findFirst({
      where: { providerId },
      select: { id: true },
    })

    await prisma.providerLocationAssignment.create({
      data: {
        providerId,
        locationId: location.id,
        isPrimary: !hasAssignments,
      },
    })
  }

  return location.id
}

export interface GetAvailableSlotsParams {
  providerId: string
  serviceId: string
  locationId?: string | null
  serviceDurationMinutes: number
  date: string
  clinicId?: string
}

/** What slot computation needs to know about a provider (one query loads it). */
const providerForSlotsInclude = (serviceId: string) =>
  ({
    providerAvailability: true,
    locationAssignments: {
      where: { location: { isActive: true } },
      include: { location: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    },
    providerServices: {
      where: { serviceId },
      include: { service: true },
    },
  }) satisfies Prisma.ProviderInclude

type ProviderForSlots = Prisma.ProviderGetPayload<{
  include: ReturnType<typeof providerForSlotsInclude>
}>

type TimeRange = { startTime: Date; endTime: Date }

/** Bookings that can block a provider's slots, possibly spanning many days. */
interface ProviderBlockers {
  appointments: TimeRange[]
  holds: (TimeRange & { expiresAt: Date })[]
  unavailabilities: ProviderUnavailability[]
}

const NO_BLOCKERS: ProviderBlockers = { appointments: [], holds: [], unavailabilities: [] }

/**
 * Where and when a provider works on one calendar date: the resolved
 * location + timezone, that date's window in the timezone, and the matching
 * weekly schedules. Pure.
 */
function resolveProviderDay(
  provider: ProviderForSlots,
  date: string,
  requestedLocationId: string | null | undefined
) {
  const assignedLocation = requestedLocationId
    ? provider.locationAssignments.find((a) => a.locationId === requestedLocationId)
    : provider.locationAssignments[0]

  const timezone =
    assignedLocation?.location.timezone ||
    provider.locationAssignments[0]?.location.timezone ||
    'UTC'
  const locationId = assignedLocation?.locationId ?? requestedLocationId ?? null

  const { start, end, weekday } = getDateWindow(date, timezone)
  const schedules = provider.providerAvailability.filter(
    (availability) =>
      availability.weekday === weekday &&
      ((availability.locationId ?? null) === (locationId ?? null) ||
        availability.locationId == null)
  )
  return { timezone, locationId, start, end, schedules }
}

/** An unavailability row as a blocked interval (server-local clock, as stored). */
function unavailabilityToInterval(unav: ProviderUnavailability): BlockedInterval {
  const baseDate = new Date(unav.date)
  baseDate.setHours(0, 0, 0, 0)
  const unavStart = unav.startTime
    ? (() => {
        const d = new Date(baseDate)
        const [h, m] = unav.startTime.split(':').map(Number)
        d.setHours(h ?? 0, m ?? 0, 0, 0)
        return d
      })()
    : new Date(baseDate)
  const unavEnd = unav.endTime
    ? (() => {
        const d = new Date(baseDate)
        const [h, m] = unav.endTime.split(':').map(Number)
        d.setHours(h ?? 0, m ?? 0, 0, 0)
        return d
      })()
    : new Date(baseDate)
  unavEnd.setHours(23, 59, 59, 999)
  return { start: unavStart, end: unavEnd }
}

/**
 * The free slots for one provider on one date, given every blocker that might
 * touch it. Pure: blockers outside the date's window are filtered here with
 * the same predicates the per-day queries use, so callers can pass rows
 * loaded for a whole range (B1.3) or for just that day.
 */
function computeProviderDaySlots(
  provider: ProviderForSlots,
  params: {
    serviceId: string
    serviceDurationMinutes: number
    date: string
    locationId?: string | null
  },
  blockers: ProviderBlockers,
  now: Date
): SchedulingSlot[] {
  if (!provider.isActive) return []
  if (provider.providerServices.length === 0) return []

  const day = resolveProviderDay(provider, params.date, params.locationId)
  if (day.schedules.length === 0) return []

  const dayStart = day.start.toJSDate()
  const dayEnd = day.end.toJSDate()
  const overlapsDay = (r: TimeRange) => r.startTime < dayEnd && r.endTime > dayStart
  const unavUpper = day.end.plus({ milliseconds: 1 }).toJSDate()
  const bufferMinutes = provider.bufferMinutes ?? 0

  const blocked: BlockedInterval[] = []
  for (const apt of blockers.appointments) {
    if (!overlapsDay(apt)) continue
    blocked.push({
      start: new Date(apt.startTime),
      end: addMinutes(new Date(apt.endTime), bufferMinutes),
    })
  }
  for (const hold of blockers.holds) {
    if (hold.expiresAt <= now || !overlapsDay(hold)) continue
    blocked.push({ start: new Date(hold.startTime), end: new Date(hold.endTime) })
  }
  for (const unav of blockers.unavailabilities) {
    if (unav.date < dayStart || unav.date >= unavUpper) continue
    blocked.push(unavailabilityToInterval(unav))
  }

  return buildCandidateSlots({
    date: params.date,
    timezone: day.timezone,
    locationId: day.locationId,
    providerId: provider.id,
    serviceId: params.serviceId,
    durationMinutes: Math.max(params.serviceDurationMinutes, MIN_APPOINTMENT_DURATION_MINUTES),
    schedules: day.schedules.map((schedule) => ({
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    })),
    blocked,
    stepMinutes: DEFAULT_SLOT_STEP_MINUTES,
  })
}

/**
 * Every blocker for the given providers that overlaps [from, to): live
 * appointments, active holds and unavailability days — three queries no
 * matter how many providers or days are asked about.
 */
async function loadBlockers(
  clinicId: string,
  providerIds: string[],
  from: Date,
  to: Date,
  now: Date
): Promise<Map<string, ProviderBlockers>> {
  const [appointments, holds, unavailabilities] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId,
        providerId: { in: providerIds },
        status: { notIn: [CANCELLED_STATUS, RESCHEDULED_STATUS] },
        startTime: { lt: to },
        endTime: { gt: from },
      },
      select: { providerId: true, startTime: true, endTime: true },
    }),
    prisma.slotHold.findMany({
      where: {
        clinicId,
        providerId: { in: providerIds },
        status: 'ACTIVE',
        expiresAt: { gt: now },
        startTime: { lt: to },
        endTime: { gt: from },
      },
      select: { providerId: true, startTime: true, endTime: true, expiresAt: true },
    }),
    prisma.providerUnavailability.findMany({
      where: { providerId: { in: providerIds }, date: { gte: from, lt: to } },
    }),
  ])

  const byProvider = new Map<string, ProviderBlockers>()
  for (const id of providerIds) {
    byProvider.set(id, { appointments: [], holds: [], unavailabilities: [] })
  }
  for (const a of appointments) byProvider.get(a.providerId)?.appointments.push(a)
  for (const h of holds) byProvider.get(h.providerId)?.holds.push(h)
  for (const u of unavailabilities) byProvider.get(u.providerId)?.unavailabilities.push(u)
  return byProvider
}

export const getAvailableSlots = async (
  params: GetAvailableSlotsParams
): Promise<SchedulingSlot[]> => {
  const { providerId, serviceId, date, clinicId } = params

  const provider = await prisma.provider.findFirst({
    where: { id: providerId, isActive: true, ...(clinicId ? { clinicId } : clinicScope()) },
    include: providerForSlotsInclude(serviceId),
  })

  if (!provider) return []
  if (!provider.isActive) return []
  if (provider.providerServices.length === 0) return []

  const day = resolveProviderDay(provider, date, params.locationId)
  if (day.schedules.length === 0) return []

  const now = new Date()
  const blockers = await loadBlockers(
    provider.clinicId,
    [provider.id],
    day.start.toJSDate(),
    day.end.plus({ milliseconds: 1 }).toJSDate(),
    now
  )

  return computeProviderDaySlots(provider, params, blockers.get(provider.id) ?? NO_BLOCKERS, now)
}

export interface PreviewAvailabilityUpdateParams {
  providerId: string
  weekday: number
  newStartTime: string
  newEndTime: string
}

export const previewAvailabilityUpdate = async (
  params: PreviewAvailabilityUpdateParams
): Promise<{ affectedCount: number; affectedAppointmentIds: string[] }> => {
  const { providerId, weekday, newStartTime, newEndTime } = params
  const now = new Date()

  const appointments = await prisma.appointment.findMany({
    where: {
      providerId,
      ...clinicScope(),
      status: { notIn: [CANCELLED_STATUS, RESCHEDULED_STATUS] },
      startTime: { gte: now },
    },
    select: { id: true, startTime: true, endTime: true },
  })

  const newStartMinutes = timeStringToMinutes(newStartTime)
  const newEndMinutes = timeStringToMinutes(newEndTime)
  const affectedAppointmentIds: string[] = []

  for (const apt of appointments) {
    const aptStart = new Date(apt.startTime)
    const aptEnd = new Date(apt.endTime)
    if (aptStart.getDay() !== weekday) continue

    const aptStartMinutes = timeToMinutes(aptStart)
    const aptEndMinutes = timeToMinutes(aptEnd)

    const fallsOutside = aptStartMinutes < newStartMinutes || aptEndMinutes > newEndMinutes
    if (fallsOutside) {
      affectedAppointmentIds.push(apt.id)
    }
  }

  return {
    affectedCount: affectedAppointmentIds.length,
    affectedAppointmentIds,
  }
}

export interface CreateAvailabilityData {
  providerId: string
  locationId?: string | null
  weekday: number
  startTime: string
  endTime: string
}

export const createAvailability = async (
  data: CreateAvailabilityData,
  clinicId: string,
  performedById: string
) => {
  assertValidAvailabilityWindow(data.startTime, data.endTime)

  const provider = await prisma.provider.findFirst({
    where: { id: data.providerId, clinicId },
  })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const onlineLocationId = await ensureOnlineLocation(data.providerId, clinicId)
  const created = await prisma.providerAvailability.create({
    data: {
      providerId: data.providerId,
      locationId: onlineLocationId,
      weekday: data.weekday,
      startTime: data.startTime,
      endTime: data.endTime,
    },
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'ProviderAvailability',
    entityId: created.id,
    action: 'CREATE',
    performedById,
  })
  return created
}

export interface UpdateAvailabilityOptions {
  force?: boolean
}

export const updateAvailability = async (
  id: string,
  data: Partial<Pick<CreateAvailabilityData, 'weekday' | 'startTime' | 'endTime'>>,
  clinicId: string,
  performedById: string,
  options?: UpdateAvailabilityOptions
) => {
  const existing = await prisma.providerAvailability.findFirst({
    where: { id },
    include: { provider: true },
  })
  if (!existing || existing.provider.clinicId !== clinicId) {
    const err = new Error('Availability not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const newWeekday = data.weekday ?? existing.weekday
  const newStartTime = data.startTime ?? existing.startTime
  const newEndTime = data.endTime ?? existing.endTime

  assertValidAvailabilityWindow(newStartTime, newEndTime)

  const preview = await previewAvailabilityUpdate({
    providerId: existing.providerId,
    weekday: newWeekday,
    newStartTime,
    newEndTime,
  })

  if (preview.affectedCount > 0 && !options?.force) {
    return {
      requiresConfirmation: true as const,
      affectedCount: preview.affectedCount,
      affectedAppointmentIds: preview.affectedAppointmentIds,
    }
  }

  const onlineLocationId = await ensureOnlineLocation(existing.providerId, clinicId)

  const updated = await prisma.providerAvailability.update({
    where: { id },
    data: {
      locationId: onlineLocationId,
      ...(data.weekday !== undefined && { weekday: data.weekday }),
      ...(data.startTime !== undefined && { startTime: data.startTime }),
      ...(data.endTime !== undefined && { endTime: data.endTime }),
    },
  })
  const changes: string[] = []
  if (data.weekday !== undefined && data.weekday !== existing.weekday) changes.push('weekday')
  if (data.startTime !== undefined && data.startTime !== existing.startTime)
    changes.push('startTime')
  if (data.endTime !== undefined && data.endTime !== existing.endTime) changes.push('endTime')
  for (const field of changes) {
    const oldVal = (existing as Record<string, unknown>)[field]
    const newVal = (updated as Record<string, unknown>)[field]
    if (oldVal !== newVal) {
      await auditService.logAudit({
        clinicId,
        entityType: 'ProviderAvailability',
        entityId: id,
        action: 'UPDATE',
        fieldChanged: field,
        oldValue: oldVal,
        newValue: newVal,
        performedById,
      })
    }
  }

  if (preview.affectedCount > 0 && options?.force) {
    await auditService.logAudit({
      clinicId,
      entityType: 'ProviderAvailability',
      entityId: id,
      action: 'AVAILABILITY_UPDATED_WITH_IMPACT',
      newValue: {
        affectedCount: preview.affectedCount,
        affectedAppointmentIds: preview.affectedAppointmentIds,
      },
      performedById,
    })
  }

  return updated
}

export interface CreateUnavailabilityData {
  providerId: string
  date: string
  startTime?: string
  endTime?: string
  reason?: string
}

export const createUnavailability = async (
  data: CreateUnavailabilityData,
  clinicId: string,
  performedById: string
) => {
  const provider = await prisma.provider.findFirst({
    where: { id: data.providerId, clinicId },
  })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const created = await prisma.providerUnavailability.create({
    data: {
      providerId: data.providerId,
      date: new Date(data.date),
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      reason: data.reason ?? null,
    },
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'ProviderUnavailability',
    entityId: created.id,
    action: 'CREATE',
    performedById,
  })
  return created
}
/**
 * Dates in [startDate, endDate] on which at least one eligible provider has a
 * free slot for the service. Set-based (B1.3): one query each for the
 * service and the providers (with schedules + locations), then the three
 * blocker tables once over the whole window, then a pure per-day/per-provider
 * pass in memory — a bounded number of queries instead of a round of queries
 * per day per provider. Results are identical to calling getAvailableSlots
 * for every day/provider (tested against that reference).
 */
export const getAvailableDatesInRange = async (params: {
  clinicId: string
  serviceId: string
  providerId?: string
  locationId?: string | null
  startDate: string
  endDate: string
}): Promise<string[]> => {
  const { clinicId, serviceId, providerId, locationId, startDate, endDate } = params

  const start = DateTime.fromISO(startDate).startOf('day')
  const end = DateTime.fromISO(endDate).endOf('day')
  if (!start.isValid || !end.isValid || end < start) return []

  const service = await prisma.service.findUnique({
    where: { id: serviceId, clinicId },
    select: { duration: true },
  })
  if (!service) return []

  const providers = await prisma.provider.findMany({
    where: {
      id: providerId,
      clinicId,
      isActive: true,
      providerServices: { some: { serviceId } },
    },
    include: providerForSlotsInclude(serviceId),
  })
  if (providers.length === 0) return []

  const dates: string[] = []
  for (let current = start; current <= end; current = current.plus({ days: 1 })) {
    dates.push(current.toISODate())
  }

  // Day windows are computed in each provider's own timezone (UTC-12 to
  // UTC+14), so load a day of margin on each side; computeProviderDaySlots
  // trims every blocker to the exact day window.
  const now = new Date()
  const from = DateTime.fromISO(dates[0]!, { zone: 'utc' }).minus({ days: 1 }).toJSDate()
  const to = DateTime.fromISO(dates[dates.length - 1]!, { zone: 'utc' })
    .plus({ days: 2 })
    .toJSDate()
  const blockers = await loadBlockers(
    clinicId,
    providers.map((p) => p.id),
    from,
    to,
    now
  )

  return dates.filter((date) =>
    providers.some(
      (provider) =>
        computeProviderDaySlots(
          provider,
          {
            serviceId,
            serviceDurationMinutes: service.duration,
            date,
            locationId: locationId ?? undefined,
          },
          blockers.get(provider.id) ?? NO_BLOCKERS,
          now
        ).length > 0
    )
  )
}

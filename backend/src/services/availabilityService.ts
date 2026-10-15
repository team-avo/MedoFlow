import { DateTime } from 'luxon'
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

export const getAvailableSlots = async (
  params: GetAvailableSlotsParams
): Promise<SchedulingSlot[]> => {
  const { providerId, serviceId, serviceDurationMinutes, date, clinicId } = params
  const normalizedDurationMinutes = Math.max(
    serviceDurationMinutes,
    MIN_APPOINTMENT_DURATION_MINUTES
  )

  const provider = await prisma.provider.findFirst({
    where: { id: providerId, isActive: true, ...(clinicId ? { clinicId } : clinicScope()) },
    include: {
      providerAvailability: true,
      locationAssignments: {
        where: { location: { isActive: true } },
        include: {
          location: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      providerServices: {
        where: { serviceId },
        include: { service: true },
      },
    },
  })

  if (!provider) return []
  if (!provider.isActive) return []
  if (provider.providerServices.length === 0) return []

  const assignedLocation = params.locationId
    ? provider.locationAssignments.find((assignment) => assignment.locationId === params.locationId)
    : provider.locationAssignments[0]

  const timezone =
    assignedLocation?.location.timezone ||
    provider.locationAssignments[0]?.location.timezone ||
    'UTC'
  const locationId = assignedLocation?.locationId ?? params.locationId ?? null

  const { start, end, weekday } = getDateWindow(date, timezone)
  const schedules = provider.providerAvailability.filter(
    (availability) =>
      availability.weekday === weekday &&
      ((availability.locationId ?? null) === (locationId ?? null) ||
        availability.locationId == null)
  )
  if (schedules.length === 0) return []

  const bufferMinutes = provider.bufferMinutes ?? 0

  const appointments = await prisma.appointment.findMany({
    where: {
      providerId,
      clinicId: provider.clinicId,
      status: { notIn: [CANCELLED_STATUS, RESCHEDULED_STATUS] },
      startTime: { lt: end.toJSDate() },
      endTime: { gt: start.toJSDate() },
    },
    select: { startTime: true, endTime: true },
  })

  const activeHolds = await prisma.slotHold.findMany({
    where: {
      providerId,
      clinicId: provider.clinicId,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      startTime: { lt: end.toJSDate() },
      endTime: { gt: start.toJSDate() },
    },
    select: { startTime: true, endTime: true },
  })

  const unavailabilities = await prisma.providerUnavailability.findMany({
    where: {
      providerId,
      date: {
        gte: start.toJSDate(),
        lt: end.plus({ milliseconds: 1 }).toJSDate(),
      },
    },
  })

  const blockedRanges: BlockedInterval[] = []

  for (const apt of appointments) {
    const start = new Date(apt.startTime)
    const end = addMinutes(new Date(apt.endTime), bufferMinutes)
    blockedRanges.push({ start, end })
  }

  for (const hold of activeHolds) {
    blockedRanges.push({
      start: new Date(hold.startTime),
      end: new Date(hold.endTime),
    })
  }

  for (const unav of unavailabilities) {
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
    blockedRanges.push({ start: unavStart, end: unavEnd })
  }

  return buildCandidateSlots({
    date,
    timezone,
    locationId,
    providerId,
    serviceId,
    durationMinutes: normalizedDurationMinutes,
    schedules: schedules.map((schedule) => ({
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    })),
    blocked: blockedRanges,
    stepMinutes: DEFAULT_SLOT_STEP_MINUTES,
  })
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
export const getAvailableDatesInRange = async (params: {
  clinicId: string
  serviceId: string
  providerId?: string
  locationId?: string | null
  startDate: string
  endDate: string
}): Promise<string[]> => {
  const { clinicId, serviceId, providerId, locationId, startDate, endDate } = params

  // For each day in the range, check if there's at least one slot.
  // This is a bit heavy, so we optimize by only checking providers who offer the service.
  const start = DateTime.fromISO(startDate).startOf('day')
  const end = DateTime.fromISO(endDate).endOf('day')

  const availableDates: string[] = []
  let current = start

  // Fetch service to get duration
  const service = await prisma.service.findUnique({
    where: { id: serviceId, clinicId },
    select: { duration: true },
  })
  if (!service) return []

  // Fetch eligible providers
  const providers = await prisma.provider.findMany({
    where: {
      id: providerId,
      clinicId,
      isActive: true,
      providerServices: { some: { serviceId } },
    },
    select: { id: true },
  })

  const pIds = providers.map((p) => p.id)
  if (pIds.length === 0) return []

  while (current <= end) {
    const dStr = current.toISODate()!
    let dayHasSlot = false

    // Check availability for each provider on this day until one is found
    for (const pid of pIds) {
      const slots = await getAvailableSlots({
        providerId: pid,
        serviceId,
        serviceDurationMinutes: service.duration,
        date: dStr,
        clinicId,
        locationId: locationId ?? undefined,
      })

      if (slots.length > 0) {
        dayHasSlot = true
        break
      }
    }

    if (dayHasSlot) {
      availableDates.push(dStr)
    }

    current = current.plus({ days: 1 })
  }

  return availableDates
}

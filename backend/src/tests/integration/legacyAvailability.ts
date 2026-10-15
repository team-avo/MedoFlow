/**
 * Reference copy of the scheduling availability code as it was before B1.3
 * (commit 711aec6), kept only so the integration suite can prove the
 * set-based getAvailableDatesInRange / getAvailableSlots return exactly the
 * same answers. Its per-day, per-provider queries are the N×M pattern B1.3
 * removed — do not use it from application code.
 */
import { DateTime } from 'luxon'
import prisma from '../../config/prisma'
import type { BlockedInterval, SchedulingSlot } from '../../services/schedulingCore'
import {
  buildCandidateSlots,
  DEFAULT_SLOT_STEP_MINUTES,
  getDateWindow,
  MIN_APPOINTMENT_DURATION_MINUTES,
} from '../../services/schedulingCore'

const CANCELLED_STATUS = 'CANCELLED'
const RESCHEDULED_STATUS = 'RESCHEDULED'

function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date)
  result.setMinutes(result.getMinutes() + minutes)
  return result
}

interface GetAvailableSlotsParams {
  providerId: string
  serviceId: string
  locationId?: string | null
  serviceDurationMinutes: number
  date: string
  clinicId?: string
}

export const legacyGetAvailableSlots = async (
  params: GetAvailableSlotsParams
): Promise<SchedulingSlot[]> => {
  const { providerId, serviceId, serviceDurationMinutes, date, clinicId } = params
  const normalizedDurationMinutes = Math.max(
    serviceDurationMinutes,
    MIN_APPOINTMENT_DURATION_MINUTES
  )

  const provider = await prisma.provider.findFirst({
    where: { id: providerId, isActive: true, clinicId },
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

export const legacyGetAvailableDatesInRange = async (params: {
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
      const slots = await legacyGetAvailableSlots({
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

import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import * as auditService from './auditService'
import * as emailService from './emailService'
import { clinicScope } from '../config/tenantContext'
import { createAppointment } from './appointmentService'
import { BookingSource, WaitlistStatus } from '@prisma/client'

const WAITING = WaitlistStatus.WAITING
const OFFERED = WaitlistStatus.OFFERED
const BOOKED = WaitlistStatus.BOOKED
const EXPIRED = WaitlistStatus.EXPIRED
const OFFER_EXPIRY_MINUTES = 30

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(23, 59, 59, 999)
  return out
}

export interface AddToWaitlistInput {
  clinicId: string
  providerId: string
  serviceId: string
  patientId: string
  preferredLocationId?: string | null
  timezone: string
  preferredDate: Date
  preferredStartTime: string
  preferredEndTime: string
}

export const addToWaitlist = async (input: AddToWaitlistInput, performedById: string) => {
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      clinicId: input.clinicId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      patientId: input.patientId,
      status: WAITING,
    },
  })
  if (existing) {
    const err = new Error(
      'You are already on the waitlist for this provider and service'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: input.clinicId },
  })
  if (!clinic) {
    const err = new Error('Clinic not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const provider = await prisma.provider.findFirst({
    where: { id: input.providerId, clinicId: input.clinicId, isActive: true },
  })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, clinicId: input.clinicId, isActive: true },
  })
  if (!service) {
    const err = new Error('Service not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const providerService = await prisma.providerService.findUnique({
    where: {
      providerId_serviceId: { providerId: input.providerId, serviceId: input.serviceId },
    },
  })
  if (!providerService) {
    const err = new Error('Provider does not offer this service') as ApiError
    err.statusCode = 400
    throw err
  }

  const user = await prisma.user.findUnique({
    where: { id: input.patientId },
  })
  if (!user || user.role !== 'PATIENT') {
    const err = new Error('Patient not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const entry = await prisma.waitlistEntry.create({
    data: {
      clinicId: input.clinicId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      patientId: input.patientId,
      preferredLocationId: input.preferredLocationId ?? null,
      timezone: input.timezone,
      preferredDate: input.preferredDate,
      preferredStartTime: input.preferredStartTime,
      preferredEndTime: input.preferredEndTime,
      status: WAITING,
    },
    include: {
      clinic: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })

  await auditService.logAudit({
    clinicId: input.clinicId,
    entityType: 'WaitlistEntry',
    entityId: entry.id,
    action: 'WAITLIST_JOINED',
    newValue: {
      providerId: input.providerId,
      serviceId: input.serviceId,
      patientId: input.patientId,
      preferredDate: input.preferredDate,
    },
    performedById,
  })

  return entry
}

export interface OfferSlotToWaitlistInput {
  clinicId: string
  providerId: string
  serviceId: string
  slotStartTime: Date
  slotEndTime: Date
  locationId?: string | null
}

export const offerSlotToWaitlist = async (input: OfferSlotToWaitlistInput) => {
  // PRD: Skip waitlist offer if service is archived, inactive, or discipline is archived
  const service = await prisma.service.findFirst({
    where: { id: input.serviceId, clinicId: input.clinicId },
    include: { discipline: { select: { isArchived: true } } },
  })
  if (!service || service.isArchived || !service.isActive || service.discipline?.isArchived) {
    return null
  }

  const slotDate = input.slotStartTime
  const dayStart = startOfDay(slotDate)
  const dayEnd = endOfDay(slotDate)

  const first = await prisma.waitlistEntry.findFirst({
    where: {
      clinicId: input.clinicId,
      providerId: input.providerId,
      serviceId: input.serviceId,
      status: WAITING,
      preferredDate: { gte: dayStart, lte: dayEnd },
      ...(input.locationId ? { preferredLocationId: input.locationId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      patient: { select: { id: true } },
    },
  })

  if (!first) return null

  const now = new Date()
  const expiresAt = new Date(now.getTime() + OFFER_EXPIRY_MINUTES * 60 * 1000)

  const offered = await prisma.waitlistEntry.update({
    where: { id: first.id, clinicId: input.clinicId },
    data: {
      status: OFFERED,
      offeredAt: now,
      expiresAt,
      offeredStartTime: input.slotStartTime,
      offeredEndTime: input.slotEndTime,
      offeredLocationId: input.locationId ?? null,
    },
    include: {
      clinic: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })

  await auditService.logAudit({
    clinicId: input.clinicId,
    entityType: 'WaitlistEntry',
    entityId: offered.id,
    action: 'WAITLIST_OFFERED',
    newValue: {
      expiresAt: expiresAt.toISOString(),
      offeredStartTime: input.slotStartTime.toISOString(),
      offeredEndTime: input.slotEndTime.toISOString(),
    },
    performedById: first.patient.id,
  })

  // Send waitlist offer email
  await emailService.sendWaitlistOffer({
    to: offered.patient.email,
    patientName: offered.patient.name,
    appointmentDate: offered.offeredStartTime!.toLocaleString(),
    serviceName: offered.service.name,
    bookingUrl: `${process.env.FRONTEND_URL}/book/${offered.serviceId}?waitlistEntryId=${offered.id}`,
  })

  return offered
}

export const expireWaitlistOffers = async (): Promise<number> => {
  const now = new Date()
  const toExpire = await prisma.waitlistEntry.findMany({
    where: {
      status: OFFERED,
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      providerId: true,
      serviceId: true,
      offeredStartTime: true,
      offeredEndTime: true,
      offeredLocationId: true,
    },
  })

  if (toExpire.length === 0) return 0

  for (const entry of toExpire) {
    await prisma.waitlistEntry.update({
      where: { id: entry.id, clinicId: entry.clinicId },
      data: { status: EXPIRED },
    })

    await auditService.logAudit({
      clinicId: entry.clinicId,
      entityType: 'WaitlistEntry',
      entityId: entry.id,
      action: 'WAITLIST_EXPIRED',
      performedById: entry.patientId,
    })

    // Cascade: Offer the same slot to the next person on the list
    if (entry.offeredStartTime && entry.offeredEndTime) {
      await offerSlotToWaitlist({
        clinicId: entry.clinicId,
        providerId: entry.providerId,
        serviceId: entry.serviceId,
        slotStartTime: entry.offeredStartTime,
        slotEndTime: entry.offeredEndTime,
        locationId: entry.offeredLocationId,
      })
    }
  }

  return toExpire.length
}

export const getMyWaitlistEntries = async (patientId: string, clinicId?: string | null) => {
  const where: { patientId: string; clinicId?: string | { in: string[] } } = {
    patientId,
    ...clinicScope(),
  }
  if (clinicId) where.clinicId = clinicId

  return prisma.waitlistEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      clinic: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
    },
  })
}

export const claimWaitlistOffer = async (
  entryId: string,
  patientId: string,
  performedById: string
) => {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: entryId, patientId, ...clinicScope() },
    include: {
      clinic: true,
      service: true,
      provider: true,
    },
  })

  if (!entry) {
    const err = new Error('Waitlist entry not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (entry.status !== OFFERED) {
    const err = new Error(
      entry.status === EXPIRED ? 'This offer has expired' : 'This entry is not available to claim'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  if (!entry.expiresAt || entry.expiresAt < new Date()) {
    await prisma.waitlistEntry.update({
      where: { id: entryId, clinicId: entry.clinicId },
      data: { status: EXPIRED },
    })
    const err = new Error('This offer has expired') as ApiError
    err.statusCode = 400
    throw err
  }

  if (!entry.offeredStartTime || !entry.offeredEndTime || !entry.offeredLocationId) {
    const err = new Error('Offer slot details are missing') as ApiError
    err.statusCode = 400
    throw err
  }

  const { appointment } = await createAppointment(
    {
      locationId: entry.offeredLocationId,
      providerId: entry.providerId,
      serviceId: entry.serviceId,
      patientId: entry.patientId,
      startTime: entry.offeredStartTime,
      endTime: entry.offeredEndTime,
    },
    entry.clinicId,
    { performedById, bookingSource: BookingSource.WAITLIST }
  )

  await prisma.waitlistEntry.update({
    where: { id: entryId, clinicId: entry.clinicId },
    data: { status: BOOKED },
  })

  await auditService.logAudit({
    clinicId: entry.clinicId,
    entityType: 'WaitlistEntry',
    entityId: entryId,
    action: 'WAITLIST_BOOKED',
    newValue: { appointmentId: appointment.id },
    performedById,
  })

  const updatedEntry = await prisma.waitlistEntry.findUnique({
    where: { id: entryId, clinicId: entry.clinicId },
    include: {
      clinic: { select: { id: true, name: true } },
      provider: {
        include: {
          disciplines: { include: { discipline: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      },
      service: { select: { id: true, name: true, duration: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })

  return { entry: updatedEntry, appointment }
}

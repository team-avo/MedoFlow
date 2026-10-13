import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import * as availabilityService from './availabilityService'
import * as auditService from './auditService'
import { buildSlotFingerprint } from './schedulingCore'

const HOLD_DURATION_MINUTES = 3

export interface CreateSlotHoldInput {
  clinicId: string
  providerId: string
  serviceId: string
  locationId?: string | null
  timezone: string
  startTime: Date
  endTime: Date
  patientId?: string
  performedById?: string
}

/**
 * Optional slot locking: Create a temporary hold for 2-3 minutes when patient selects a slot.
 * Release hold automatically if booking not completed.
 */
export const createSlotHold = async (input: CreateSlotHoldInput) => {
  const expiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60 * 1000)
  const date = input.startTime.toISOString().slice(0, 10)

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot-hold:${input.providerId}`}))`

    const availableSlots = await availabilityService.getAvailableSlots({
      providerId: input.providerId,
      serviceId: input.serviceId,
      locationId: input.locationId ?? null,
      serviceDurationMinutes:
        (
          await tx.service.findUnique({
            where: { id: input.serviceId, clinicId: input.clinicId },
            select: { duration: true },
          })
        )?.duration ?? Math.round((input.endTime.getTime() - input.startTime.getTime()) / 60000),
      date,
      clinicId: input.clinicId,
    })

    const requestedFingerprint = buildSlotFingerprint({
      providerId: input.providerId,
      locationId: input.locationId ?? null,
      start: input.startTime,
      end: input.endTime,
    })

    const matchingSlot = availableSlots.find(
      (slot) => buildSlotFingerprint(slot) === requestedFingerprint
    )

    if (!matchingSlot) {
      const err = new Error(
        'Selected slot is no longer available. Please choose another.'
      ) as ApiError
      err.statusCode = 409
      err.code = 'invalid_slot'
      throw err
    }

    const hold = await tx.slotHold.create({
      data: {
        clinicId: input.clinicId,
        providerId: input.providerId,
        serviceId: input.serviceId,
        locationId: input.locationId ?? null,
        timezone: input.timezone,
        startTime: input.startTime,
        endTime: input.endTime,
        patientId: input.patientId ?? null,
        expiresAt,
        status: 'ACTIVE',
      },
    })

    if (input.performedById) {
      await auditService.logAudit({
        clinicId: input.clinicId,
        entityType: 'SlotHold',
        entityId: hold.id,
        action: 'HOLD_CREATED',
        newValue: {
          providerId: input.providerId,
          locationId: input.locationId ?? null,
          startTime: input.startTime.toISOString(),
          endTime: input.endTime.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
        performedById: input.performedById,
      })
    }

    return hold
  })
}

export const releaseSlotHold = async (holdId: string, clinicId: string, performedById?: string) => {
  const hold = await prisma.slotHold.findFirst({
    where: { id: holdId, clinicId, status: 'ACTIVE' },
  })
  if (!hold) return false

  await prisma.slotHold.update({
    where: { id: holdId, clinicId },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
    },
  })

  if (performedById) {
    await auditService.logAudit({
      clinicId,
      entityType: 'SlotHold',
      entityId: holdId,
      action: 'HOLD_RELEASED',
      oldValue: { status: hold.status },
      newValue: { status: 'RELEASED' },
      performedById,
    })
  }

  return true
}

export const validateAndConsumeSlotHold = async (
  holdId: string,
  clinicId: string,
  providerId: string,
  serviceId: string,
  locationId: string | null | undefined,
  startTime: Date,
  endTime: Date
) => {
  const hold = await prisma.slotHold.findFirst({
    where: { id: holdId, clinicId, status: 'ACTIVE' },
  })
  if (!hold) return false
  if (hold.expiresAt < new Date()) {
    await prisma.slotHold.update({
      where: { id: hold.id, clinicId },
      data: {
        status: 'EXPIRED',
        expiredAt: new Date(),
      },
    })
    return false
  }
  if (
    hold.providerId !== providerId ||
    hold.serviceId !== serviceId ||
    (hold.locationId ?? null) !== (locationId ?? null)
  )
    return false
  if (
    hold.startTime.getTime() !== startTime.getTime() ||
    hold.endTime.getTime() !== endTime.getTime()
  )
    return false

  await prisma.slotHold.update({
    where: { id: holdId, clinicId },
    data: { status: 'CONVERTED' },
  })
  return true
}

/**
 * Expire old slot holds. Call from cron or periodically.
 */
export const expireSlotHolds = async (): Promise<number> => {
  const result = await prisma.slotHold.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: 'ACTIVE',
    },
    data: {
      status: 'EXPIRED',
      expiredAt: new Date(),
    },
  })
  return result.count
}

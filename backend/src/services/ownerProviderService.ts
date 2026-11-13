/**
 * The account creator is a provider automatically (CTO-14).
 *
 * In a US practice the owner is usually the doctor as well as the clinic
 * admin. When the owner's practitioner row says "I see patients", they get
 * exactly one Provider linked to their user, ready to book and scribe without
 * an extra "Add me" step:
 *
 *  - linked to the user (idempotent: revisiting the step never adds another),
 *  - assigned to every active location and every active service,
 *  - given default weekday hours (Mon to Fri, 09:00 to 17:00, all locations)
 *    only when they have no hours yet, so nothing the owner set is overwritten.
 *
 * A non-clinical owner unticks "I see patients": no Provider is created, and
 * one created earlier is deactivated (never deleted: appointments keep it).
 */
import prisma from '../config/prisma'
import * as auditService from './auditService'
import { linkAdminAsProvider } from './staffService'

export const DEFAULT_WEEKDAY_HOURS = { weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }

/** Links every active location and service to the provider; returns the counts added. */
export async function assignProviderEverywhere(providerId: string, clinicId: string) {
  const [locations, services] = await Promise.all([
    prisma.location.findMany({ where: { clinicId, isActive: true }, select: { id: true } }),
    prisma.service.findMany({ where: { clinicId, isActive: true }, select: { id: true } }),
  ])
  const hasPrimary = await prisma.providerLocationAssignment.count({
    where: { providerId, isPrimary: true },
  })
  const loc = await prisma.providerLocationAssignment.createMany({
    data: locations.map((l, i) => ({
      providerId,
      locationId: l.id,
      isPrimary: !hasPrimary && i === 0,
    })),
    skipDuplicates: true,
  })
  const svc = await prisma.providerService.createMany({
    data: services.map((s) => ({ providerId, serviceId: s.id })),
    skipDuplicates: true,
  })
  return { locations: loc.count, services: svc.count }
}

/** Default weekday hours for a provider who has none yet. */
export async function ensureDefaultHours(providerId: string) {
  const existing = await prisma.providerAvailability.count({ where: { providerId } })
  if (existing > 0) return 0
  const { weekdays, start, end } = DEFAULT_WEEKDAY_HOURS
  const created = await prisma.providerAvailability.createMany({
    data: weekdays.map((weekday) => ({
      providerId,
      // null = every location the provider works at.
      locationId: null,
      weekday,
      startTime: start,
      endTime: end,
    })),
  })
  return created.count
}

/**
 * Applies the owner's "I see patients" choice from the practitioners step.
 * Returns the owner's provider id, or null for a non-clinical owner.
 */
export async function syncOwnerProvider(params: {
  clinicId: string
  ownerUserId: string
  seesPatients: boolean
  performedById: string
}): Promise<string | null> {
  const { clinicId, ownerUserId, seesPatients, performedById } = params
  const existing = await prisma.provider.findFirst({
    where: { userId: ownerUserId, clinicId },
    select: { id: true, isActive: true, clinicId: true },
  })

  if (!seesPatients) {
    if (existing?.isActive && existing.clinicId === clinicId) {
      await prisma.provider.updateMany({
        where: { id: existing.id, clinicId },
        data: { isActive: false },
      })
      await auditService.logAudit({
        clinicId,
        entityType: 'Provider',
        entityId: existing.id,
        action: 'UPDATE',
        fieldChanged: 'isActive',
        oldValue: true,
        newValue: false,
        performedById,
      })
    }
    return null
  }

  const provider = existing ?? (await linkAdminAsProvider(ownerUserId, clinicId, performedById))
  if (existing && !existing.isActive) {
    await prisma.provider.updateMany({
      where: { id: existing.id, clinicId },
      data: { isActive: true },
    })
    await auditService.logAudit({
      clinicId,
      entityType: 'Provider',
      entityId: existing.id,
      action: 'UPDATE',
      fieldChanged: 'isActive',
      oldValue: false,
      newValue: true,
      performedById,
    })
  }
  await assignProviderEverywhere(provider.id, clinicId)
  await ensureDefaultHours(provider.id)
  return provider.id
}

/**
 * A solo practice: when a clinic has exactly one active provider, a new
 * service is theirs to offer straight away (otherwise it has nobody to book
 * with until someone assigns it). Larger practices assign services per
 * provider, as before.
 */
export async function assignNewServiceToSoloProvider(serviceId: string, clinicId: string) {
  const providers = await prisma.provider.findMany({
    where: { clinicId, isActive: true },
    select: { id: true },
    take: 2,
  })
  if (providers.length !== 1) return null
  await prisma.providerService.createMany({
    data: [{ providerId: providers[0]!.id, serviceId }],
    skipDuplicates: true,
  })
  return providers[0]!.id
}

import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import * as auditService from './auditService'

/** The synthetic location online availability hangs off; not a real place. */
const ONLINE_NAMES = ['online', 'virtual']

/**
 * CTO-34: the application's "number of locations" follows the clinic's real,
 * active, physical locations as they are added and removed.
 */
export async function syncLocationCount(clinicId: string) {
  const locations = await prisma.location.findMany({
    where: { clinicId, isActive: true },
    select: { name: true },
  })
  const count = Math.max(
    1,
    locations.filter((l) => !ONLINE_NAMES.includes(l.name.trim().toLowerCase())).length
  )
  await prisma.clinicProfile.updateMany({ where: { clinicId }, data: { locationCount: count } })
  return count
}

export interface CreateLocationData {
  name: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  phone?: string
  timezone: string
}

type ClinicWhere = { clinicId?: string } | Record<string, never>

export const createLocation = async (
  data: CreateLocationData,
  clinicId: string,
  performedById: string
) => {
  const location = await prisma.location.create({
    data: {
      clinicId,
      name: data.name,
      address: data.address,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country,
      phone: data.phone,
      timezone: data.timezone,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Location',
    entityId: location.id,
    action: 'CREATE',
    newValue: {
      name: location.name,
      timezone: location.timezone,
    },
    performedById,
  })

  // CTO-34: a solo practice's provider works at every location it opens.
  const providers = await prisma.provider.findMany({
    where: { clinicId, isActive: true },
    select: { id: true },
    take: 2,
  })
  if (providers.length === 1) {
    await prisma.providerLocationAssignment.createMany({
      data: [{ providerId: providers[0]!.id, locationId: location.id }],
      skipDuplicates: true,
    })
  }
  await syncLocationCount(clinicId)

  return location
}

export const getLocations = async (where: ClinicWhere) => {
  const whereClause = { ...clinicScope(), ...where, isActive: true }
  return prisma.location.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    orderBy: { name: 'asc' },
  })
}

export type UpdateLocationData = Partial<CreateLocationData>

/**
 * Edit a location of the caller's clinic (onboarding wizard + dashboard).
 * 404 when the id belongs to another clinic, 409 on a duplicate name.
 */
export const updateLocation = async (
  id: string,
  data: UpdateLocationData,
  clinicId: string,
  performedById: string
) => {
  const existing = await prisma.location.findFirst({ where: { id, clinicId } })
  if (!existing) {
    throw Object.assign(new Error('Location not found'), { statusCode: 404 })
  }
  if (data.name && data.name !== existing.name) {
    const clash = await prisma.location.findFirst({
      where: { clinicId, name: data.name, id: { not: id } },
      select: { id: true },
    })
    if (clash) {
      throw Object.assign(new Error('A location with this name already exists'), {
        statusCode: 409,
      })
    }
  }

  const fields = [
    'name',
    'address',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
    'phone',
    'timezone',
  ] as const
  const changes: Partial<Record<(typeof fields)[number], string>> = {}
  for (const f of fields) {
    if (data[f] !== undefined && data[f] !== existing[f]) changes[f] = data[f]
  }
  if (Object.keys(changes).length === 0) return existing

  const location = await prisma.location.update({
    where: { id, clinicId },
    data: changes,
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Location',
    entityId: id,
    action: 'UPDATE',
    fieldChanged: Object.keys(changes).join(','),
    oldValue: { name: existing.name, timezone: existing.timezone },
    newValue: { name: location.name, timezone: location.timezone },
    performedById,
  })

  return location
}

/**
 * CTO-34: remove a location. It is deactivated, never deleted (past
 * appointments keep pointing at it). Refused (409) while future appointments
 * are booked there, or when it is the clinic's last location.
 */
export const removeLocation = async (id: string, clinicId: string, performedById: string) => {
  const existing = await prisma.location.findFirst({ where: { id, clinicId, isActive: true } })
  if (!existing) throw Object.assign(new Error('Location not found'), { statusCode: 404 })
  const others = await prisma.location.count({
    where: { clinicId, isActive: true, id: { not: id } },
  })
  if (others === 0) {
    throw Object.assign(new Error('A clinic needs at least one location'), { statusCode: 409 })
  }
  const upcoming = await prisma.appointment.count({
    where: {
      clinicId,
      locationId: id,
      startTime: { gt: new Date() },
      status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_PROVIDER_APPROVAL', 'DRAFT'] },
    },
  })
  if (upcoming > 0) {
    throw Object.assign(
      new Error(
        `${upcoming} upcoming appointment${upcoming > 1 ? 's are' : ' is'} booked here. Move or cancel ${upcoming > 1 ? 'them' : 'it'} first.`
      ),
      { statusCode: 409 }
    )
  }
  await prisma.location.update({ where: { id, clinicId }, data: { isActive: false } })
  await auditService.logAudit({
    clinicId,
    entityType: 'Location',
    entityId: id,
    action: 'DELETE',
    oldValue: { name: existing.name },
    performedById,
  })
  await syncLocationCount(clinicId)
  return { id }
}

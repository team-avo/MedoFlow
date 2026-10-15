import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import * as auditService from './auditService'

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

  return location
}

export const getLocations = async (where: ClinicWhere) => {
  const whereClause = { ...clinicScope(), ...where, isActive: true }
  return prisma.location.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    orderBy: { name: 'asc' },
  })
}

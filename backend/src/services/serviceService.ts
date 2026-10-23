import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import { uniqueEntitySlug } from '../site/services/slugService'

export interface CreateServiceData {
  disciplineId: string
  name: string
  duration: number
  defaultPrice: number | string
  taxApplicable?: boolean
  recommendedProductIds?: string[]
}

type ClinicWhere = { clinicId?: string } | Record<string, never>

const validateDisciplineBelongsToClinic = async (disciplineId: string, clinicId: string) => {
  const discipline = await prisma.discipline.findFirst({
    where: { id: disciplineId, clinicId },
  })
  if (!discipline) {
    const err = new Error('Discipline not found or does not belong to this clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  return discipline
}

export const createService = async (
  data: CreateServiceData,
  clinicId: string,
  performedById: string
) => {
  await validateDisciplineBelongsToClinic(data.disciplineId, clinicId)

  const existing = await prisma.service.findFirst({
    where: { clinicId, name: data.name },
  })
  if (existing) {
    const err = new Error('Service with this name already exists in this clinic') as ApiError
    err.statusCode = 409
    throw err
  }

  const service = await prisma.service.create({
    data: {
      clinicId,
      disciplineId: data.disciplineId,
      name: data.name,
      slug: await uniqueEntitySlug('service', clinicId, data.name),
      duration: data.duration,
      defaultPrice: data.defaultPrice,
      taxApplicable: data.taxApplicable ?? false,
      recommendedProducts: {
        connect: data.recommendedProductIds?.map((id) => ({ id })) ?? [],
      },
    },
    include: {
      discipline: { select: { id: true, name: true } },
      recommendedProducts: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Service',
    entityId: service.id,
    action: 'CREATE',
    newValue: {
      name: service.name,
      defaultPrice: service.defaultPrice.toString(),
      disciplineId: service.discipline.id,
    },
    performedById,
  })

  return service
}

export const getServices = async (where: ClinicWhere) => {
  const whereClause = { ...clinicScope(), ...where, isActive: true }
  return prisma.service.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    orderBy: { name: 'asc' },
    include: {
      discipline: { select: { id: true, name: true } },
      _count: { select: { providerServices: true } },
    },
  })
}

export const getServiceById = async (id: string, where: ClinicWhere = {}) => {
  const whereClause = { id, ...clinicScope(), ...where }
  return prisma.service.findFirst({
    where: whereClause as { id: string; clinicId?: string | { in: string[] } },
    include: {
      discipline: { select: { id: true, name: true } },
      recommendedProducts: true,
    },
  })
}

export const updateService = async (
  id: string,
  data: Partial<CreateServiceData & { isActive?: boolean; disciplineId?: string }>,
  where: ClinicWhere,
  performedById: string
) => {
  const service = await prisma.service.findUnique({ where: { id, ...clinicScope(), ...where } })
  if (!service) {
    const err = new Error('Service not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const clinicId = 'clinicId' in where ? where.clinicId : service.clinicId

  if (data.name) {
    const existing = await prisma.service.findFirst({
      where: {
        clinicId: clinicId || undefined,
        name: data.name,
        NOT: { id },
      },
    })
    if (existing) {
      const err = new Error('Service with this name already exists in this clinic') as ApiError
      err.statusCode = 409
      throw err
    }
  }

  if (data.disciplineId) {
    await validateDisciplineBelongsToClinic(data.disciplineId, clinicId || service.clinicId)
  }

  const updated = await prisma.service.update({
    where: { id, clinicId: service.clinicId },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.duration !== undefined && { duration: data.duration }),
      ...(data.defaultPrice !== undefined && { defaultPrice: data.defaultPrice }),
      ...(data.taxApplicable !== undefined && { taxApplicable: data.taxApplicable }),
      ...(data.disciplineId && { disciplineId: data.disciplineId }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.recommendedProductIds && {
        recommendedProducts: {
          set: data.recommendedProductIds.map((id) => ({ id })),
        },
      }),
    },
    include: {
      discipline: { select: { id: true, name: true } },
      recommendedProducts: true,
    },
  })

  const cid = clinicId || service.clinicId
  if (
    data.defaultPrice !== undefined &&
    String(service.defaultPrice) !== String(data.defaultPrice)
  ) {
    await auditService.logAudit({
      clinicId: cid,
      entityType: 'Service',
      entityId: id,
      action: 'UPDATE',
      fieldChanged: 'defaultPrice',
      oldValue: service.defaultPrice.toString(),
      newValue: String(data.defaultPrice),
      performedById,
    })
  }

  const auditFields: Array<'name' | 'duration' | 'disciplineId' | 'taxApplicable'> = [
    'name',
    'duration',
    'disciplineId',
    'taxApplicable',
  ]
  for (const field of auditFields) {
    if (data[field] !== undefined && service[field] !== updated[field]) {
      await auditService.logAudit({
        clinicId: cid,
        entityType: 'Service',
        entityId: id,
        action: 'UPDATE',
        fieldChanged: field,
        oldValue: service[field] as string | number | boolean | null,
        newValue: updated[field] as string | number | boolean | null,
        performedById,
      })
    }
  }

  return updated
}

export const archiveService = async (id: string, where: ClinicWhere, performedById: string) => {
  const service = await getServiceById(id, where)
  if (!service) {
    const err = new Error('Service not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const futureBookings = await prisma.appointment.count({
    where: {
      serviceId: id,
      clinicId: service.clinicId,
      startTime: { gt: new Date() },
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
  })
  if (futureBookings > 0) {
    const err = new Error('Cannot archive a service with upcoming appointments.') as ApiError
    err.statusCode = 400
    throw err
  }
  const updated = await prisma.service.update({
    where: { id, clinicId: service.clinicId },
    data: { isActive: false, isArchived: true },
    include: {
      discipline: { select: { id: true, name: true } },
    },
  })
  if (service.isActive) {
    await auditService.logAudit({
      clinicId: service.clinicId,
      entityType: 'Service',
      entityId: id,
      action: 'ARCHIVE',
      fieldChanged: 'isActive',
      oldValue: true,
      newValue: false,
      performedById,
    })
  }
  return updated
}

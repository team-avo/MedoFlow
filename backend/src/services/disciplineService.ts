import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'

export interface CreateDisciplineData {
  name: string
  description?: string
}

type ClinicWhere = { clinicId?: string } | Record<string, never>

export const createDiscipline = async (
  data: CreateDisciplineData,
  clinicId: string,
  performedById: string
) => {
  const existing = await prisma.discipline.findFirst({
    where: { clinicId, name: data.name },
  })
  if (existing) {
    const err = new Error('Discipline with this name already exists in this clinic') as ApiError
    err.statusCode = 409
    throw err
  }
  const discipline = await prisma.discipline.create({
    data: {
      clinicId,
      name: data.name,
      description: data.description,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Discipline',
    entityId: discipline.id,
    action: 'CREATE',
    newValue: {
      name: discipline.name,
      description: discipline.description,
    },
    performedById,
  })

  return discipline
}

export const getDisciplines = async (where: ClinicWhere) => {
  const whereClause = { ...clinicScope(), ...where, isActive: true }
  return prisma.discipline.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    orderBy: { name: 'asc' },
    include: { _count: { select: { providerDisciplines: true } } },
  })
}

export const getDisciplineById = async (id: string, where: ClinicWhere = {}) => {
  const whereClause = { id, ...clinicScope(), ...where }
  return prisma.discipline.findFirst({
    where: whereClause as { id: string; clinicId?: string | { in: string[] } },
  })
}

export const updateDiscipline = async (
  id: string,
  data: Partial<CreateDisciplineData>,
  where: ClinicWhere,
  performedById: string
) => {
  const discipline = await prisma.discipline.findUnique({
    where: { id, ...clinicScope(), ...where },
  })
  if (!discipline) {
    const err = new Error('Discipline not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const clinicId = 'clinicId' in where ? where.clinicId : discipline.clinicId
  if (data.name) {
    const existing = await prisma.discipline.findFirst({
      where: {
        clinicId: clinicId || undefined,
        name: data.name,
        NOT: { id },
      },
    })
    if (existing) {
      const err = new Error('Discipline with this name already exists in this clinic') as ApiError
      err.statusCode = 409
      throw err
    }
  }
  const updated = await prisma.discipline.update({
    where: { id, clinicId: discipline.clinicId },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
    },
  })

  const auditFields: Array<keyof CreateDisciplineData> = ['name', 'description']
  for (const field of auditFields) {
    if (data[field] !== undefined && discipline[field] !== updated[field]) {
      await auditService.logAudit({
        clinicId: discipline.clinicId,
        entityType: 'Discipline',
        entityId: id,
        action: 'UPDATE',
        fieldChanged: field,
        oldValue: discipline[field] ?? null,
        newValue: updated[field] ?? null,
        performedById,
      })
    }
  }

  return updated
}

/**
 * Archive discipline (never delete). PRD: Cannot delete if services exist.
 * Instead set isArchived = true. Services under archived discipline remain visible in historical data.
 */
export const deleteDiscipline = async (id: string, where: ClinicWhere, performedById: string) => {
  const findWhere = { id, ...clinicScope(), ...where }
  const discipline = await prisma.discipline.findFirst({
    where: findWhere as { id: string; clinicId?: string | { in: string[] } },
  })
  if (!discipline) {
    const err = new Error('Discipline not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const activeServicesCount = await prisma.service.count({
    where: {
      clinicId: discipline.clinicId,
      disciplineId: id,
      isActive: true,
      isArchived: false,
    },
  })
  if (activeServicesCount > 0) {
    const err = new Error(
      'Cannot archive discipline while active services exist. Archive services first.'
    ) as ApiError
    err.statusCode = 400
    throw err
  }
  const updateWhere = { id, clinicId: discipline.clinicId }
  const updated = await prisma.discipline.update({
    where: updateWhere,
    data: { isActive: false, isArchived: true },
  })
  if (discipline.isActive || !discipline.isArchived) {
    await auditService.logAudit({
      clinicId: discipline.clinicId,
      entityType: 'Discipline',
      entityId: id,
      action: 'ARCHIVE',
      fieldChanged: 'isArchived',
      oldValue: discipline.isArchived,
      newValue: true,
      performedById,
    })
  }
  return updated
}

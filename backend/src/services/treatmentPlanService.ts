import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import type { TreatmentPlanStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'

export interface CreateTreatmentPlanData {
  patientId: string
  providerId: string
  disciplineId: string
  name: string
  totalSessions: number
  startDate: string | Date
  endDate?: string | Date | null
  goals?: Prisma.InputJsonValue
  notes?: string | null
}

export interface UpdateTreatmentPlanData {
  name?: string
  totalSessions?: number
  sessionsCompleted?: number
  startDate?: string | Date
  endDate?: string | Date | null
  goals?: Prisma.InputJsonValue
  notes?: string | null
}

const includeRelations = {
  clinic: { select: { id: true, name: true } },
  patient: { select: { id: true, name: true, email: true } },
  provider: {
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true } },
    },
  },
  discipline: { select: { id: true, name: true } },
}

export const createTreatmentPlan = async (
  data: CreateTreatmentPlanData,
  clinicId: string,
  performedById: string
) => {
  if (!data.providerId) {
    const err = new Error('Provider ID is required') as ApiError
    err.statusCode = 400
    throw err
  }
  const provider = await prisma.provider.findFirst({
    where: { id: data.providerId, clinicId, isActive: true },
  })
  if (!provider) {
    const err = new Error('Provider not found or does not belong to clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  const discipline = await prisma.discipline.findFirst({
    where: { id: data.disciplineId, clinicId },
  })
  if (!discipline) {
    const err = new Error('Discipline not found or does not belong to clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  const patient = await prisma.user.findFirst({
    where: { id: data.patientId },
  })
  if (!patient) {
    const err = new Error('Patient not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const plan = await prisma.treatmentPlan.create({
    data: {
      clinicId,
      patientId: data.patientId,
      providerId: data.providerId,
      disciplineId: data.disciplineId,
      name: data.name,
      totalSessions: data.totalSessions,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      goals: data.goals ?? Prisma.JsonNull,
      notes: data.notes ?? null,
    },
    include: includeRelations,
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'TreatmentPlan',
    entityId: plan.id,
    action: 'TREATMENT_PLAN_CREATED',
    fieldChanged: null,
    oldValue: null,
    newValue: { name: plan.name, patientId: plan.patientId, providerId: plan.providerId },
    performedById,
  })
  return plan
}

export const getTreatmentPlansByPatient = async (patientId: string, clinicId: string) => {
  return prisma.treatmentPlan.findMany({
    where: { patientId, clinicId },
    orderBy: { createdAt: 'desc' },
    include: includeRelations,
  })
}

export const getTreatmentPlans = async (opts: {
  clinicId: string
  providerId?: string
  status?: 'ACTIVE' | 'COMPLETED' | 'DISCONTINUED'
}) => {
  const where: Prisma.TreatmentPlanWhereInput = {
    clinicId: opts.clinicId,
  }
  if (opts.providerId) where.providerId = opts.providerId
  if (opts.status) where.status = opts.status as TreatmentPlanStatus
  return prisma.treatmentPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: includeRelations,
  })
}

export const getTreatmentPlanById = async (
  id: string,
  where: { clinicId?: string | { in: string[] }; providerId?: string } = {}
) => {
  const whereClause =
    Object.keys(where).length === 0 ? { id, ...clinicScope() } : { id, ...clinicScope(), ...where }
  return prisma.treatmentPlan.findFirst({
    where: whereClause as { id: string; clinicId?: string | { in: string[] }; providerId?: string },
    include: includeRelations,
  })
}

export const updateTreatmentPlan = async (
  id: string,
  data: UpdateTreatmentPlanData,
  performedById: string,
  where: { clinicId?: string; providerId?: string }
) => {
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id, ...clinicScope(), ...where },
  })
  if (!plan) {
    const err = new Error('Treatment plan not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (plan.status === 'COMPLETED' || plan.status === 'DISCONTINUED') {
    const err = new Error('Cannot modify a COMPLETED or DISCONTINUED treatment plan') as ApiError
    err.statusCode = 400
    throw err
  }
  const updateData: Prisma.TreatmentPlanUpdateInput = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.totalSessions !== undefined) updateData.totalSessions = data.totalSessions
  if (data.sessionsCompleted !== undefined) updateData.sessionsCompleted = data.sessionsCompleted
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate)
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null
  if (data.goals !== undefined) updateData.goals = data.goals
  if (data.notes !== undefined) updateData.notes = data.notes

  const newSessionsCompleted = data.sessionsCompleted ?? plan.sessionsCompleted
  const newTotalSessions = data.totalSessions ?? plan.totalSessions
  if (data.sessionsCompleted !== undefined && newSessionsCompleted >= newTotalSessions) {
    updateData.status = 'COMPLETED'
    updateData.endDate = new Date()
    updateData.sessionsCompleted = newTotalSessions
  }

  const updated = await prisma.treatmentPlan.update({
    where: { id, clinicId: plan.clinicId },
    data: updateData,
    include: includeRelations,
  })
  await auditService.logAudit({
    clinicId: plan.clinicId,
    entityType: 'TreatmentPlan',
    entityId: id,
    action: 'TREATMENT_PLAN_UPDATED',
    fieldChanged: 'status',
    oldValue: { status: plan.status },
    newValue: { status: updated.status },
    performedById,
  })
  return updated
}

export const completeTreatmentPlan = async (
  id: string,
  performedById: string,
  where: { clinicId?: string; providerId?: string }
) => {
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id, ...clinicScope(), ...where },
  })
  if (!plan) {
    const err = new Error('Treatment plan not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (plan.status === 'COMPLETED') {
    const err = new Error('Treatment plan is already completed') as ApiError
    err.statusCode = 400
    throw err
  }
  if (plan.status === 'DISCONTINUED') {
    const err = new Error('Cannot complete a DISCONTINUED treatment plan') as ApiError
    err.statusCode = 400
    throw err
  }
  const updated = await prisma.treatmentPlan.update({
    where: { id, clinicId: plan.clinicId },
    data: {
      status: 'COMPLETED',
      sessionsCompleted: plan.totalSessions,
      endDate: new Date(),
    },
    include: includeRelations,
  })
  await auditService.logAudit({
    clinicId: plan.clinicId,
    entityType: 'TreatmentPlan',
    entityId: id,
    action: 'TREATMENT_PLAN_COMPLETED',
    fieldChanged: 'status',
    oldValue: { status: plan.status },
    newValue: { status: 'COMPLETED' },
    performedById,
  })
  return updated
}

export const discontinueTreatmentPlan = async (
  id: string,
  performedById: string,
  where: { clinicId?: string; providerId?: string }
) => {
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id, ...clinicScope(), ...where },
  })
  if (!plan) {
    const err = new Error('Treatment plan not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (plan.status === 'DISCONTINUED') {
    const err = new Error('Treatment plan is already discontinued') as ApiError
    err.statusCode = 400
    throw err
  }
  const updated = await prisma.treatmentPlan.update({
    where: { id, clinicId: plan.clinicId },
    data: { status: 'DISCONTINUED' },
    include: includeRelations,
  })
  await auditService.logAudit({
    clinicId: plan.clinicId,
    entityType: 'TreatmentPlan',
    entityId: id,
    action: 'TREATMENT_PLAN_DISCONTINUED',
    fieldChanged: 'status',
    oldValue: { status: plan.status },
    newValue: { status: 'DISCONTINUED' },
    performedById,
  })
  return updated
}

export const getProviderByUserId = async (userId: string) => {
  return prisma.provider.findFirst({
    where: { userId, ...clinicScope() },
  })
}

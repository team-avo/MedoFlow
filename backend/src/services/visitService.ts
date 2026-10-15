import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'

export interface CreateVisitRecordData {
  appointmentId: string
  patientId?: string
  subjective?: string
  objective?: string
  assessment?: string
  plan?: string
}

export const getProviderByUserId = async (userId: string) => {
  return prisma.provider.findFirst({
    where: { userId, ...clinicScope() },
  })
}

const validateAppointmentForProvider = async (
  appointmentId: string,
  providerId: string,
  clinicId: string
) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, providerId, clinicId },
  })
  if (!appointment) {
    const err = new Error('Appointment not found or provider not assigned') as ApiError
    err.statusCode = 404
    throw err
  }
  return appointment
}

export const createVisitRecord = async (
  data: CreateVisitRecordData,
  providerId: string,
  clinicId: string,
  createdById: string
) => {
  const { appointmentId, patientId, subjective, objective, assessment, plan } = data

  await validateAppointmentForProvider(appointmentId, providerId, clinicId)

  const existing = await prisma.visitRecord.findUnique({
    where: { appointmentId, clinicId },
  })
  if (existing) {
    const err = new Error('Visit record already exists for this appointment') as ApiError
    err.statusCode = 409
    throw err
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId, clinicId },
    select: {
      patientId: true,
      serviceId: true,
      disciplineId: true,
      locationId: true,
    },
  })

  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.visitRecord.create({
      data: {
        clinicId,
        appointmentId,
        providerId,
        serviceId: appointment.serviceId ?? null,
        disciplineId: appointment.disciplineId ?? null,
        locationId: appointment.locationId ?? null,
        patientId: patientId || appointment.patientId,
        subjective,
        objective,
        assessment,
        plan,
      },
    })
    const version = await tx.visitNoteVersion.create({
      data: {
        visitRecordId: created.id,
        subjective,
        objective,
        assessment,
        plan,
        createdById,
      },
    })
    await tx.visitRecord.update({
      where: { id: created.id, clinicId },
      data: { currentVersionId: version.id },
    })
    return created
  })

  return prisma.visitRecord.findFirst({
    where: { id: record.id, clinicId },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
    },
  })
}

export const getVisitRecordByAppointment = async (
  appointmentId: string,
  clinicId?: string | null,
  includeHistory = false
) => {
  const where: { appointmentId: string; clinicId?: string | { in: string[] } } = {
    appointmentId,
    ...clinicScope(),
  }
  if (clinicId) where.clinicId = clinicId

  return prisma.visitRecord.findFirst({
    where,
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
      ...(includeHistory && {
        versions: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      }),
    },
  })
}

export const getVisitRecordById = async (
  id: string,
  where: { clinicId?: string } | Record<string, never> = {},
  includeHistory = false
) => {
  return prisma.visitRecord.findFirst({
    where: { id, ...clinicScope(), ...where },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
      ...(includeHistory && {
        versions: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      }),
    },
  })
}

export interface UpdateVisitRecordData extends Partial<CreateVisitRecordData> {
  expectedVersionId?: string
}

export const updateVisitRecord = async (
  id: string,
  data: UpdateVisitRecordData,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const record = await getVisitRecordById(id, { clinicId })
  if (!record) {
    const err = new Error('Visit record not found') as ApiError
    err.statusCode = 404
    throw err
  }

  // Optimistic Concurrency Check
  if (data.expectedVersionId && record.currentVersionId !== data.expectedVersionId) {
    const err = new Error(
      'This record has been updated by another user. Please refresh and try again.'
    ) as ApiError
    err.statusCode = 409
    throw err
  }

  if (record.providerId !== providerId) {
    const err = new Error('Only the provider who created the record can edit it') as ApiError
    err.statusCode = 403
    throw err
  }
  const visitRecord = record as { isFinalized?: boolean }
  if (visitRecord.isFinalized) {
    const err = new Error('Visit record is finalized and cannot be updated') as ApiError
    err.statusCode = 400
    throw err
  }

  const version = await prisma.visitNoteVersion.create({
    data: {
      visitRecordId: id,
      subjective: data.subjective !== undefined ? data.subjective : record.subjective,
      objective: data.objective !== undefined ? data.objective : record.objective,
      assessment: data.assessment !== undefined ? data.assessment : record.assessment,
      plan: data.plan !== undefined ? data.plan : record.plan,
      createdById: performedById,
    },
  })

  return prisma.visitRecord.update({
    where: {
      id,
      clinicId,
      ...(data.expectedVersionId && { currentVersionId: data.expectedVersionId }),
    },
    data: {
      currentVersionId: version.id,
      ...(data.subjective !== undefined && { subjective: data.subjective }),
      ...(data.objective !== undefined && { objective: data.objective }),
      ...(data.assessment !== undefined && { assessment: data.assessment }),
      ...(data.plan !== undefined && { plan: data.plan }),
    },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
    },
  })
}

export const finalizeVisitRecord = async (
  id: string,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const record = await getVisitRecordById(id, { clinicId })
  if (!record) {
    const err = new Error('Visit record not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (record.providerId !== providerId) {
    const err = new Error('Only the provider who created the record can finalize it') as ApiError
    err.statusCode = 403
    throw err
  }

  const updated = await prisma.visitRecord.update({
    where: { id, clinicId },
    data: { status: 'FINAL', isFinalized: true },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'VisitRecord',
    entityId: id,
    action: 'VISIT_FINALIZED',
    fieldChanged: 'status',
    oldValue: record.status,
    newValue: 'FINAL',
    performedById,
  })

  return updated
}

export const getVisitRecordsByPatient = async (patientId: string, clinicId?: string | null) => {
  const where: { patientId: string; clinicId?: string | { in: string[] } } = {
    patientId,
    ...clinicScope(),
  }
  if (clinicId) where.clinicId = clinicId
  return prisma.visitRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
    },
  })
}

export const getVisitRecordsByClinic = async (clinicId: string) => {
  return prisma.visitRecord.findMany({
    where: { clinicId },
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
      currentVersion: true,
    },
  })
}

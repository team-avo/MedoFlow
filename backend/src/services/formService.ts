import type { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import { logAudit } from './auditService'
import type { ApiError } from '../types/errors'
import type { FormScope } from '@prisma/client'
import * as patientMembershipService from './patientMembershipService'

type ClinicWhere = { clinicId?: string } | Record<string, never>

export interface CreateTemplateData {
  name: string
  description?: string
  scope: FormScope
  disciplineId?: string
  serviceId?: string
  fields: Prisma.InputJsonValue
}

const validateScope = (
  scope: FormScope,
  disciplineId?: string | null,
  serviceId?: string | null
): void => {
  if (scope === 'CLINIC' && (disciplineId || serviceId)) {
    const err = new Error('CLINIC scope must not have disciplineId or serviceId') as ApiError
    err.statusCode = 400
    throw err
  }
  if (scope === 'DISCIPLINE' && !disciplineId) {
    const err = new Error('DISCIPLINE scope requires disciplineId') as ApiError
    err.statusCode = 400
    throw err
  }
  if (scope === 'SERVICE' && !serviceId) {
    const err = new Error('SERVICE scope requires serviceId') as ApiError
    err.statusCode = 400
    throw err
  }
}

export const createTemplate = async (
  data: CreateTemplateData,
  clinicId: string,
  performedById: string
) => {
  validateScope(data.scope, data.disciplineId, data.serviceId)

  if (data.disciplineId) {
    const disc = await prisma.discipline.findFirst({
      where: { id: data.disciplineId, clinicId },
    })
    if (!disc) {
      const err = new Error('Discipline not found') as ApiError
      err.statusCode = 404
      throw err
    }
  }
  if (data.serviceId) {
    const svc = await prisma.service.findFirst({
      where: { id: data.serviceId, clinicId },
    })
    if (!svc) {
      const err = new Error('Service not found') as ApiError
      err.statusCode = 404
      throw err
    }
  }

  const template = await prisma.formTemplate.create({
    data: {
      clinicId,
      name: data.name,
      description: data.description,
      scope: data.scope,
      disciplineId: data.disciplineId ?? null,
      serviceId: data.serviceId ?? null,
      fields: data.fields,
    },
  })

  await logAudit({
    clinicId,
    entityType: 'FormTemplate',
    entityId: template.id,
    action: 'FORM_TEMPLATE_CREATED',
    newValue: { name: data.name, scope: data.scope },
    performedById,
  })

  return template
}

export const listTemplates = async (where: ClinicWhere) => {
  const whereClause =
    Object.keys(where).length === 0
      ? { ...clinicScope(), isActive: true }
      : { ...clinicScope(), ...where, isActive: true }
  return prisma.formTemplate.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    include: {
      discipline: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  })
}

export const getTemplateById = async (id: string, where: ClinicWhere = {}) => {
  const whereClause =
    Object.keys(where).length === 0 ? { id, ...clinicScope() } : { id, ...clinicScope(), ...where }
  return prisma.formTemplate.findFirst({
    where: whereClause as { id: string; clinicId?: string | { in: string[] } },
    include: {
      discipline: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  })
}

export const updateTemplate = async (
  id: string,
  data: Partial<CreateTemplateData>,
  where: ClinicWhere,
  performedById: string
) => {
  const existing = await getTemplateById(id, where)
  if (!existing) {
    const err = new Error('Form template not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const merged = {
    scope: data.scope ?? existing.scope,
    disciplineId: data.disciplineId !== undefined ? data.disciplineId : existing.disciplineId,
    serviceId: data.serviceId !== undefined ? data.serviceId : existing.serviceId,
  }
  validateScope(merged.scope, merged.disciplineId, merged.serviceId)

  if (merged.disciplineId) {
    const disc = await prisma.discipline.findFirst({
      where: { id: merged.disciplineId, clinicId: existing.clinicId },
    })
    if (!disc) {
      const err = new Error('Discipline not found') as ApiError
      err.statusCode = 404
      throw err
    }
  }
  if (merged.serviceId) {
    const svc = await prisma.service.findFirst({
      where: { id: merged.serviceId, clinicId: existing.clinicId },
    })
    if (!svc) {
      const err = new Error('Service not found') as ApiError
      err.statusCode = 404
      throw err
    }
  }

  const template = await prisma.formTemplate.update({
    where: { id, clinicId: existing.clinicId },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.scope && { scope: data.scope }),
      ...(data.disciplineId !== undefined && { disciplineId: data.disciplineId }),
      ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
      ...(data.fields && { fields: data.fields }),
    },
  })

  await logAudit({
    clinicId: existing.clinicId,
    entityType: 'FormTemplate',
    entityId: id,
    action: 'FORM_TEMPLATE_UPDATED',
    newValue: { name: template.name, scope: template.scope },
    performedById,
  })

  return template
}

export const disableTemplate = async (id: string, where: ClinicWhere, performedById: string) => {
  const existing = await getTemplateById(id, where)
  if (!existing) {
    const err = new Error('Form template not found') as ApiError
    err.statusCode = 404
    throw err
  }
  if (!existing.isActive) {
    const err = new Error('Form template already disabled') as ApiError
    err.statusCode = 400
    throw err
  }

  await prisma.formTemplate.update({
    where: { id, clinicId: existing.clinicId },
    data: { isActive: false },
  })

  await logAudit({
    clinicId: existing.clinicId,
    entityType: 'FormTemplate',
    entityId: id,
    action: 'FORM_TEMPLATE_DISABLED',
    oldValue: { isActive: true },
    newValue: { isActive: false },
    performedById,
  })
}

export const submitResponse = async (params: {
  clinicId: string
  templateId: string
  patientId: string
  appointmentId?: string | null
  responses: Prisma.InputJsonValue
  performedById: string
}) => {
  const template = await prisma.formTemplate.findFirst({
    where: { id: params.templateId, clinicId: params.clinicId, isActive: true },
  })
  if (!template) {
    const err = new Error('Form template not found or inactive') as ApiError
    err.statusCode = 404
    throw err
  }

  const patient = await prisma.user.findFirst({
    where: { id: params.patientId, role: 'PATIENT' },
  })
  if (!patient) {
    const err = new Error('Patient not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (params.appointmentId) {
    const apt = await prisma.appointment.findFirst({
      where: {
        id: params.appointmentId,
        patientId: params.patientId,
        clinicId: params.clinicId,
      },
    })
    if (!apt) {
      const err = new Error('Appointment not found or does not belong to patient') as ApiError
      err.statusCode = 404
      throw err
    }
  }

  const response = await prisma.formResponse.create({
    data: {
      clinicId: params.clinicId,
      templateId: params.templateId,
      patientId: params.patientId,
      appointmentId: params.appointmentId ?? null,
      responses: params.responses,
    },
  })

  await logAudit({
    clinicId: params.clinicId,
    entityType: 'FormResponse',
    entityId: response.id,
    action: 'FORM_RESPONSE_SUBMITTED',
    newValue: { templateId: params.templateId, patientId: params.patientId },
    performedById: params.performedById,
  })

  return response
}

export const getTemplatesForAppointment = async (appointmentId: string, patientId: string) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, patientId, ...clinicScope() },
    include: {
      service: { select: { id: true, disciplineId: true } },
    },
  })
  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const clinicId = appointment.clinicId
  const serviceId = appointment.serviceId
  const disciplineId = appointment.service.disciplineId

  const templates = await prisma.formTemplate.findMany({
    where: {
      isActive: true,
      clinicId,
      OR: [
        { scope: 'CLINIC', disciplineId: null, serviceId: null },
        { scope: 'DISCIPLINE', disciplineId },
        { scope: 'SERVICE', serviceId },
      ],
    },
    include: {
      discipline: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: [{ scope: 'asc' }, { name: 'asc' }],
  })

  return templates
}

export const getPatientPrimaryClinic = async (patientId: string) => {
  return prisma.patientClinicMembership.findFirst({
    where: { patientId, isActive: true, ...clinicScope() },
    select: { clinicId: true },
    orderBy: { updatedAt: 'desc' },
  })
}

export const getResponsesByPatient = async (
  clinicId: string,
  patientId: string,
  skipMembershipCheck: boolean = false
) => {
  if (!skipMembershipCheck) {
    await patientMembershipService.assertPatientBelongsToClinic(patientId, clinicId)
  }
  return prisma.formResponse.findMany({
    where: { clinicId, patientId },
    include: {
      template: { select: { id: true, name: true, scope: true, fields: true } },
      appointment: { select: { id: true, startTime: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

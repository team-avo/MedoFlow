import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { logAudit } from './auditService'

export interface CreatePrescriptionData {
  appointmentId: string
  patientId?: string
  notes: string
}

const validateAppointmentForPrescription = async (
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
  if (appointment.status !== 'COMPLETED') {
    const err = new Error('Appointment must be COMPLETED before creating prescription') as ApiError
    err.statusCode = 400
    throw err
  }
  return appointment
}

export const createPrescription = async (
  data: CreatePrescriptionData,
  providerId: string,
  clinicId: string,
  performedById: string
) => {
  const { appointmentId, patientId, notes } = data

  const appointment = await validateAppointmentForPrescription(appointmentId, providerId, clinicId)
  // B3.3: a prescription belongs to the appointment's patient — never to a
  // different patient named in the request body.
  if (patientId && patientId !== appointment.patientId) {
    const err = new Error('patientId does not match the appointment') as ApiError
    err.statusCode = 400
    err.code = 'validation_error'
    throw err
  }

  const prescription = await prisma.prescription.create({
    data: {
      clinicId,
      appointmentId,
      providerId,
      patientId: appointment.patientId,
      notes,
    },
    include: {
      appointment: { select: { id: true, startTime: true, status: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
  await logAudit({
    clinicId,
    entityType: 'Prescription',
    entityId: prescription.id,
    action: 'PRESCRIPTION_CREATED',
    newValue: {
      appointmentId,
      patientId: prescription.patientId,
      providerId,
      notesLength: notes.length,
    },
    performedById,
  })
  return prescription
}

export const getPrescriptionsByPatient = async (patientId: string, clinicId?: string | null) => {
  const where: { patientId: string; clinicId?: string | { in: string[] } } = {
    patientId,
    ...clinicScope(),
  }
  if (clinicId) where.clinicId = clinicId

  return prisma.prescription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: { select: { id: true, startTime: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
    },
  })
}

export const getPrescriptionsByProvider = async (providerId: string, clinicId?: string | null) => {
  const where: { providerId: string; clinicId?: string | { in: string[] } } = {
    providerId,
    ...clinicScope(),
  }
  if (clinicId) where.clinicId = clinicId

  return prisma.prescription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: { select: { id: true, startTime: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
}

export const getPrescriptionsByClinic = async (clinicId: string) => {
  return prisma.prescription.findMany({
    where: { clinicId },
    orderBy: { createdAt: 'desc' },
    include: {
      appointment: { select: { id: true, startTime: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      patient: { select: { id: true, name: true, email: true } },
    },
  })
}

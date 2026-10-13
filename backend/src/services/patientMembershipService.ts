import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

export const ensurePatientClinicMembership = async (params: {
  clinicId: string
  patientId: string
  primaryLocationId?: string | null
}) => {
  const patient = await prisma.user.findUnique({
    where: { id: params.patientId },
    select: { id: true, role: true, isActive: true },
  })

  if (!patient || patient.role !== 'PATIENT' || !patient.isActive) {
    const err = new Error('Patient not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (params.primaryLocationId) {
    const location = await prisma.location.findFirst({
      where: {
        id: params.primaryLocationId,
        clinicId: params.clinicId,
        isActive: true,
      },
      select: { id: true },
    })

    if (!location) {
      const err = new Error('Location not found for clinic') as ApiError
      err.statusCode = 404
      throw err
    }
  }

  return prisma.patientClinicMembership.upsert({
    where: {
      clinicId_patientId: {
        clinicId: params.clinicId,
        patientId: params.patientId,
      },
    },
    create: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      primaryLocationId: params.primaryLocationId ?? null,
      isActive: true,
    },
    update: {
      isActive: true,
      ...(params.primaryLocationId !== undefined && {
        primaryLocationId: params.primaryLocationId,
      }),
    },
  })
}

export const assertPatientBelongsToClinic = async (patientId: string, clinicId: string) => {
  const membership = await prisma.patientClinicMembership.findFirst({
    where: {
      clinicId,
      patientId,
      isActive: true,
    },
    select: { id: true },
  })

  if (!membership) {
    const err = new Error('Patient does not belong to clinic') as ApiError
    err.statusCode = 403
    throw err
  }

  return membership
}

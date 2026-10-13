import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'

export const getAvailablePatientPackages = async (clinicId: string, patientId: string) => {
  const packages = await prisma.patientPackage.findMany({
    where: {
      clinicId,
      patientId,
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      // usedSessions < totalSessions handled by application logic or query
    },
    include: {
      package: true,
    },
  })

  return packages.filter((pkg) => pkg.usedSessions < pkg.totalSessions)
}

export const findValidPackageForService = async (
  clinicId: string,
  patientId: string,
  _serviceId: string
) => {
  // In a real app, we might check if the package specifically covers this service.
  // For Phase 1, we'll assume clinic packages cover any service in the clinic unless restricted.
  // We can add a many-to-many relation Package <-> Service if needed later.
  const packages = await prisma.patientPackage.findMany({
    where: {
      clinicId,
      patientId,
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      package: true,
    },
  })

  return packages.find((p) => p.usedSessions < p.totalSessions)
}

export const consumePackageSession = async (patientPackageId: string, appointmentId: string) => {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.patientPackage.findUnique({
      where: { id: patientPackageId, ...clinicScope() },
    })

    if (!pkg || pkg.status !== 'ACTIVE' || pkg.usedSessions >= pkg.totalSessions) {
      throw new Error('Package not available or exhausted') as ApiError
    }

    const updated = await tx.patientPackage.update({
      where: { id: patientPackageId, clinicId: pkg.clinicId },
      data: {
        usedSessions: { increment: 1 },
        status: pkg.usedSessions + 1 >= pkg.totalSessions ? 'EXHAUSTED' : 'ACTIVE',
      },
    })

    await tx.packageSessionUsage.create({
      data: {
        patientPackageId,
        appointmentId,
      },
    })

    return updated
  })
}

export const releasePackageSession = async (appointmentId: string) => {
  return prisma.$transaction(async (tx) => {
    const usage = await tx.packageSessionUsage.findUnique({
      where: { appointmentId },
      include: { patientPackage: true },
    })

    if (!usage) return null

    await tx.packageSessionUsage.delete({
      where: { id: usage.id },
    })

    const nextUsedSessions = Math.max(usage.patientPackage.usedSessions - 1, 0)
    return tx.patientPackage.update({
      where: { id: usage.patientPackageId, ...clinicScope() },
      data: {
        usedSessions: nextUsedSessions,
        status:
          nextUsedSessions < usage.patientPackage.totalSessions
            ? 'ACTIVE'
            : usage.patientPackage.status,
      },
    })
  })
}

export const transferPackageSessionReservation = async (
  fromAppointmentId: string,
  toAppointmentId: string
) => {
  return prisma.$transaction(async (tx) => {
    const usage = await tx.packageSessionUsage.findUnique({
      where: { appointmentId: fromAppointmentId },
    })

    if (!usage) return null

    return tx.packageSessionUsage.update({
      where: { id: usage.id },
      data: { appointmentId: toAppointmentId },
    })
  })
}

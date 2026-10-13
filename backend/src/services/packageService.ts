import prisma from '../config/prisma'
import { ApiError } from '../types/errors'

export const getPackages = async (clinicId: string, includeInactive = false) => {
  return prisma.package.findMany({
    where: { clinicId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { createdAt: 'desc' },
  })
}

export const getPackageById = async (id: string, clinicId: string) => {
  const pkg = await prisma.package.findFirst({
    where: { id, clinicId },
  })

  if (!pkg) {
    const err = new Error('Package not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return pkg
}

export interface CreatePackageInput {
  name: string
  description?: string
  price: number
  totalSessions?: number
  expiresInDays?: number
}

export const createPackage = async (clinicId: string, input: CreatePackageInput) => {
  return prisma.package.create({
    data: {
      clinicId,
      name: input.name,
      description: input.description,
      price: input.price,
      totalSessions: input.totalSessions,
      expiresInDays: input.expiresInDays,
    },
  })
}

export interface UpdatePackageInput {
  name?: string
  description?: string
  price?: number
  totalSessions?: number
  expiresInDays?: number
  isActive?: boolean
}

export const updatePackage = async (id: string, clinicId: string, input: UpdatePackageInput) => {
  const existing = await prisma.package.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    const err = new Error('Package not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return prisma.package.update({
    where: { id, clinicId },
    data: input,
  })
}

export const deletePackage = async (id: string, clinicId: string) => {
  const existing = await prisma.package.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    const err = new Error('Package not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return prisma.package.update({
    where: { id, clinicId },
    data: { isActive: false },
  })
}

export const getPackageOperationalSummary = async (clinicId: string) => {
  const [patientPackages, recentPatientPackages, activeCatalogPackages] = await Promise.all([
    prisma.patientPackage.findMany({
      where: { clinicId },
      include: {
        package: true,
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.patientPackage.findMany({
      where: { clinicId },
      include: {
        package: true,
        patient: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    }),
    prisma.package.count({
      where: { clinicId, isActive: true },
    }),
  ])

  const now = new Date()
  const exhaustedCount = patientPackages.filter(
    (pkg) => pkg.usedSessions >= pkg.totalSessions || pkg.status === 'EXHAUSTED'
  ).length
  const expiringSoonCount = patientPackages.filter((pkg) => {
    if (!pkg.expiresAt) return false
    const msUntilExpiry = pkg.expiresAt.getTime() - now.getTime()
    return msUntilExpiry >= 0 && msUntilExpiry <= 1000 * 60 * 60 * 24 * 14
  }).length

  return {
    activeCatalogPackages,
    patientPackageCount: patientPackages.length,
    activePatientPackageCount: patientPackages.filter((pkg) => pkg.status === 'ACTIVE').length,
    exhaustedCount,
    expiringSoonCount,
    remainingSessionsTotal: patientPackages.reduce(
      (sum, pkg) => sum + Math.max(pkg.totalSessions - pkg.usedSessions, 0),
      0
    ),
    recentPatientPackages: recentPatientPackages.map((pkg) => ({
      ...pkg,
      remainingSessions: Math.max(pkg.totalSessions - pkg.usedSessions, 0),
    })),
  }
}

import * as argon2 from 'argon2'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import * as passwordSetupService from './passwordSetupService'
import * as emailService from './emailService'
import { clinicScope, withTenantBypass } from '../config/tenantContext'
import { uniqueEntitySlug } from '../site/services/slugService'

export interface CreateProviderServiceInput {
  serviceId: string
  priceOverride?: number
}

export interface CreateProviderData {
  firstName: string
  lastName: string
  email: string
  phone?: string
  disciplineIds: string[]
  locationIds?: string[]
  userId?: string | null
  serviceIds?: string[]
  /** Services with optional price override (takes precedence over serviceIds) */
  services?: CreateProviderServiceInput[]
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

const validateUserBelongsToClinic = async (userId: string, clinicId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, clinicId },
  })
  if (!user) {
    const err = new Error('User not found or does not belong to this clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  return user
}

const checkDuplicateProviderUserLink = async (userId: string) => {
  // Provider.userId is globally unique, so the duplicate check must see every clinic.
  const existing = await withTenantBypass('provider.user_link_uniqueness_check', () =>
    prisma.provider.findFirst({
      where: { userId },
      select: { id: true },
    })
  )
  if (existing) {
    const err = new Error('User is already linked to another provider') as ApiError
    err.statusCode = 409
    throw err
  }
}

const validateServiceBelongsToClinic = async (serviceId: string, clinicId: string) => {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, clinicId, isActive: true },
  })
  if (!service) {
    const err = new Error('Service not found or does not belong to this clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  return service
}

const validateLocationBelongsToClinic = async (locationId: string, clinicId: string) => {
  const location = await prisma.location.findFirst({
    where: { id: locationId, clinicId, isActive: true },
  })
  if (!location) {
    const err = new Error('Location not found or does not belong to this clinic') as ApiError
    err.statusCode = 404
    throw err
  }
  return location
}

const resolveProviderLocationIds = async (clinicId: string, locationIds?: string[]) => {
  if (locationIds?.length) {
    for (const locationId of locationIds) {
      await validateLocationBelongsToClinic(locationId, clinicId)
    }
    return Array.from(new Set(locationIds))
  }

  const defaultLocations = await prisma.location.findMany({
    where: { clinicId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  return defaultLocations.map((location) => location.id)
}

/** Re-add a deactivated provider: reactivate user and provider, update details and services. */
async function reactivateAndUpdateProvider(
  providerId: string,
  data: CreateProviderData,
  clinicId: string,
  locationIds: string[],
  servicesInput: CreateProviderServiceInput[],
  performedById: string
) {
  const provider = await prisma.provider.findFirst({
    where: { id: providerId, clinicId },
    include: { user: { select: { id: true } } },
  })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const providerName = `${data.firstName} ${data.lastName}`.trim()
  const email = (data.email ?? '').trim().toLowerCase()

  if (provider.userId) {
    await prisma.user.update({
      where: { id: provider.userId },
      data: { name: providerName, isActive: true },
    })
  }

  await prisma.provider.update({
    where: { id: providerId, clinicId },
    data: {
      isActive: true,
      firstName: data.firstName,
      lastName: data.lastName,
      email,
      phone: data.phone ?? null,
    },
  })

  await prisma.providerDiscipline.deleteMany({ where: { providerId } })
  await prisma.providerDiscipline.createMany({
    data: data.disciplineIds.map((disciplineId) => ({ providerId, disciplineId })),
  })

  await prisma.providerLocationAssignment.deleteMany({ where: { providerId } })
  await prisma.providerLocationAssignment.createMany({
    data: locationIds.map((locationId, index) => ({
      providerId,
      locationId,
      isPrimary: index === 0,
    })),
  })

  await prisma.providerService.deleteMany({ where: { providerId } })
  for (const item of servicesInput) {
    await prisma.providerService.create({
      data: {
        providerId,
        serviceId: item.serviceId,
        priceOverride: item.priceOverride ?? null,
      },
    })
  }

  if (provider.userId) {
    const token = await passwordSetupService.createPasswordSetupToken(provider.userId)
    const frontendUrl = (
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '')
    const setupLink = `${frontendUrl}/set-password?token=${token}`
    await emailService.sendProviderInviteEmail(email, providerName, setupLink)
  }

  await auditService.logAudit({
    clinicId,
    entityType: 'Provider',
    entityId: providerId,
    action: 'REACTIVATE',
    fieldChanged: 'isActive',
    oldValue: false,
    newValue: true,
    performedById,
  })

  return prisma.provider.findUnique({
    where: { id: providerId, clinicId },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
      providerServices: {
        include: {
          service: { include: { discipline: { select: { id: true, name: true } } } },
        },
      },
    },
  })
}

export const createProvider = async (
  data: CreateProviderData,
  clinicId: string,
  performedById: string
) => {
  if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
    const err = new Error('SMTP is required to invite providers in production') as ApiError
    err.statusCode = 500
    throw err
  }

  const email = (data.email ?? '').trim()
  if (!email) {
    const err = new Error('Valid email is required.') as ApiError
    err.statusCode = 400
    throw err
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    const err = new Error('Valid email is required.') as ApiError
    err.statusCode = 400
    throw err
  }

  if (!data.disciplineIds?.length) {
    const err = new Error('At least one discipline is required') as ApiError
    err.statusCode = 400
    throw err
  }
  for (const disciplineId of data.disciplineIds) {
    await validateDisciplineBelongsToClinic(disciplineId, clinicId)
  }

  const locationIds = await resolveProviderLocationIds(clinicId, data.locationIds)

  const servicesInput: CreateProviderServiceInput[] =
    data.services && data.services.length > 0
      ? data.services
      : (data.serviceIds?.map((id) => ({ serviceId: id })) ?? [])

  if (servicesInput.length === 0) {
    const err = new Error('Provider must offer at least one service.') as ApiError
    err.statusCode = 400
    throw err
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      provider: { select: { id: true, clinicId: true, isActive: true } },
    },
  })
  if (existingUser) {
    const existingProvider = existingUser.provider
    if (existingProvider && existingProvider.clinicId === clinicId && !existingProvider.isActive) {
      return reactivateAndUpdateProvider(
        existingProvider.id,
        data,
        clinicId,
        locationIds,
        servicesInput,
        performedById
      )
    }
    const err = new Error('A provider with this email already exists.') as ApiError
    err.statusCode = 409
    throw err
  }

  const providerName = `${data.firstName} ${data.lastName}`.trim()
  const tempPassword = 'pending-setup'
  const hashedPassword = await argon2.hash(tempPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name: providerName,
      password: hashedPassword,
      role: 'PROVIDER',
      clinicId,
    },
    select: { id: true },
  })

  const token = await passwordSetupService.createPasswordSetupToken(user.id)
  const frontendUrl = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
  const setupLink = `${frontendUrl}/set-password?token=${token}`
  await emailService.sendProviderInviteEmail(email, providerName, setupLink)

  const provider = await prisma.provider.create({
    data: {
      clinicId,
      userId: user.id,
      firstName: data.firstName,
      lastName: data.lastName,
      slug: await uniqueEntitySlug('provider', clinicId, `${data.firstName} ${data.lastName}`),
      email,
      phone: data.phone,
      disciplines: {
        create: data.disciplineIds.map((disciplineId) => ({ disciplineId })),
      },
      locationAssignments: {
        create: locationIds.map((locationId, index) => ({
          locationId,
          isPrimary: index === 0,
        })),
      },
    },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
    },
  })

  for (const item of servicesInput) {
    const { serviceId, priceOverride } = item
    await validateServiceBelongsToClinic(serviceId, clinicId)
    await prisma.providerService.create({
      data: {
        providerId: provider.id,
        serviceId,
        priceOverride: priceOverride ?? null,
      },
    })
  }
  await auditService.logAudit({
    clinicId,
    entityType: 'User',
    entityId: user.id,
    action: 'CREATE',
    fieldChanged: 'role',
    oldValue: null,
    newValue: 'PROVIDER',
    performedById,
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Provider',
    entityId: provider.id,
    action: 'CREATE',
    newValue: {
      email,
      disciplineIds: data.disciplineIds,
      locationIds,
    },
    performedById,
  })

  return prisma.provider.findUnique({
    where: { id: provider.id, clinicId },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
      providerServices: {
        include: {
          service: { include: { discipline: { select: { id: true, name: true } } } },
        },
      },
    },
  })
}

export const getProviders = async (where: ClinicWhere) => {
  const whereClause =
    Object.keys(where).length === 0
      ? { isActive: true, ...clinicScope() }
      : { ...where, isActive: true }
  return prisma.provider.findMany({
    where: whereClause as { isActive: boolean; clinicId?: string | { in: string[] } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
      providerServices: {
        include: {
          service: { select: { id: true, name: true, defaultPrice: true } },
        },
      },
    },
  })
}

export const getProviderById = async (id: string, where: ClinicWhere = {}) => {
  const whereClause = Object.keys(where).length === 0 ? { id, ...clinicScope() } : { id, ...where }
  return prisma.provider.findFirst({
    where: whereClause as { id: string; clinicId?: string | { in: string[] } },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      providerAvailability: true,
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
    },
  })
}

export const updateProvider = async (
  id: string,
  data: Partial<CreateProviderData & { isActive?: boolean }>,
  where: ClinicWhere,
  performedById: string
) => {
  const provider = await getProviderById(id, where)
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const clinicId = 'clinicId' in where ? where.clinicId : undefined

  if (data.disciplineIds && data.disciplineIds.length > 0 && clinicId) {
    for (const disciplineId of data.disciplineIds) {
      await validateDisciplineBelongsToClinic(disciplineId, clinicId)
    }
  }

  if (data.locationIds && clinicId) {
    await resolveProviderLocationIds(clinicId, data.locationIds)
  }

  if (data.userId !== undefined) {
    if (data.userId && provider.clinicId) {
      await validateUserBelongsToClinic(data.userId, provider.clinicId)
      if (data.userId !== provider.userId) {
        await checkDuplicateProviderUserLink(data.userId)
      }
    }
  }

  // PRD: Block booking when provider inactive. Return affected appointments for admin reassignment UI.
  if (data.isActive === false && provider.isActive) {
    const affected = await prisma.appointment.findMany({
      where: {
        providerId: id,
        clinicId: provider.clinicId,
        startTime: { gt: new Date() },
        status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        patientId: true,
        serviceId: true,
        locationId: true,
      },
      orderBy: { startTime: 'asc' },
    })
    if (affected.length > 0) {
      const err = new Error(
        'Cannot deactivate provider with future appointments. Reassign or cancel them first.'
      ) as ApiError
      err.statusCode = 400
      err.affectedAppointments = affected
      throw err
    }
  }

  const baseData: Record<string, unknown> = {
    ...(data.firstName && { firstName: data.firstName }),
    ...(data.lastName && { lastName: data.lastName }),
    ...(data.email !== undefined && { email: data.email }),
    ...(data.phone !== undefined && { phone: data.phone }),
    ...(data.userId !== undefined && { userId: data.userId || null }),
    ...(data.isActive !== undefined && { isActive: data.isActive }),
  }

  if (data.disciplineIds && data.disciplineIds.length > 0) {
    await prisma.providerDiscipline.deleteMany({ where: { providerId: id } })
    ;(baseData as { disciplines?: { create: { disciplineId: string }[] } }).disciplines = {
      create: data.disciplineIds.map((disciplineId) => ({ disciplineId })),
    }
  }

  const updatedProvider = await prisma.provider.update({
    where: { id, clinicId: provider.clinicId },
    data: baseData as Parameters<typeof prisma.provider.update>[0]['data'],
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
    },
  })

  if (data.locationIds && clinicId) {
    await prisma.providerLocationAssignment.deleteMany({
      where: { providerId: id },
    })

    await prisma.providerLocationAssignment.createMany({
      data: data.locationIds.map((locationId, index) => ({
        providerId: id,
        locationId,
        isPrimary: index === 0,
      })),
    })
  }

  if (data.isActive !== undefined && provider.userId) {
    await prisma.user.update({
      where: { id: provider.userId },
      data: { isActive: data.isActive },
    })
  }

  await auditService.logAudit({
    clinicId: provider.clinicId,
    entityType: 'Provider',
    entityId: id,
    action: 'UPDATE',
    newValue: {
      firstName: updatedProvider.firstName,
      lastName: updatedProvider.lastName,
      email: updatedProvider.email,
      isActive: updatedProvider.isActive,
      locationIds: data.locationIds,
    },
    performedById,
  })

  if (!data.locationIds) {
    return updatedProvider
  }

  return prisma.provider.findUnique({
    where: { id, clinicId: provider.clinicId },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
      locationAssignments: {
        include: {
          location: { select: { id: true, name: true, timezone: true } },
        },
      },
    },
  })
}

export const softDeleteProvider = async (id: string, where: ClinicWhere, performedById: string) => {
  const provider = await getProviderById(id, where)
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const affected = await prisma.appointment.findMany({
    where: {
      providerId: id,
      clinicId: provider.clinicId,
      startTime: { gt: new Date() },
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      patientId: true,
      serviceId: true,
      locationId: true,
    },
    orderBy: { startTime: 'asc' },
  })
  if (affected.length > 0) {
    const err = new Error(
      'Cannot deactivate provider with future appointments. Reassign or cancel them first.'
    ) as ApiError
    err.statusCode = 400
    err.affectedAppointments = affected
    throw err
  }

  const updated = await prisma.provider.update({
    where: { id, clinicId: provider.clinicId },
    data: { isActive: false },
    include: {
      disciplines: { include: { discipline: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true, email: true } },
    },
  })

  if (provider.userId) {
    await prisma.user.update({
      where: { id: provider.userId },
      data: { isActive: false },
    })
  }

  await auditService.logAudit({
    clinicId: provider.clinicId,
    entityType: 'Provider',
    entityId: id,
    action: 'ARCHIVE',
    fieldChanged: 'isActive',
    oldValue: true,
    newValue: false,
    performedById,
  })

  if (provider.userId) {
    await auditService.logAudit({
      clinicId: provider.clinicId,
      entityType: 'User',
      entityId: provider.userId,
      action: 'DEACTIVATE',
      fieldChanged: 'isActive',
      oldValue: true,
      newValue: false,
      performedById,
    })
  }

  return updated
}

export const addProviderService = async (
  providerId: string,
  serviceId: string,
  priceOverride: number | string | null | undefined,
  clinicId: string,
  performedById: string
) => {
  const provider = await getProviderById(providerId, { clinicId })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  await validateServiceBelongsToClinic(serviceId, clinicId)

  const existing = await prisma.providerService.findFirst({
    where: { providerId, serviceId },
  })
  if (existing) {
    const err = new Error('Provider already has this service assigned') as ApiError
    err.statusCode = 409
    throw err
  }

  const assignment = await prisma.providerService.create({
    data: {
      providerId,
      serviceId,
      priceOverride: priceOverride ?? null,
    },
    include: {
      service: {
        include: { discipline: { select: { id: true, name: true } } },
      },
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'ProviderService',
    entityId: assignment.id,
    action: 'CREATE',
    newValue: {
      serviceId,
      priceOverride: assignment.priceOverride?.toString() ?? null,
    },
    performedById,
  })

  return assignment
}

export const updateProviderService = async (
  providerId: string,
  serviceId: string,
  priceOverride: number | string | null | undefined,
  clinicId: string,
  performedById: string
) => {
  const provider = await getProviderById(providerId, { clinicId })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }
  await validateServiceBelongsToClinic(serviceId, clinicId)

  const existing = await prisma.providerService.findFirst({
    where: { providerId, serviceId },
  })
  if (!existing) {
    const err = new Error('Provider service assignment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const newPrice = priceOverride ?? null
  const oldStr = existing.priceOverride?.toString() ?? null
  const newStr = newPrice != null ? String(newPrice) : null

  const updated = await prisma.providerService.update({
    where: { id: existing.id },
    data: { priceOverride: newPrice },
    include: {
      service: {
        include: { discipline: { select: { id: true, name: true } } },
      },
    },
  })

  if (oldStr !== newStr) {
    await auditService.logAudit({
      clinicId,
      entityType: 'ProviderService',
      entityId: existing.id,
      action: 'UPDATE',
      fieldChanged: 'priceOverride',
      oldValue: oldStr,
      newValue: newStr,
      performedById,
    })
  }

  return updated
}

export const removeProviderService = async (
  providerId: string,
  serviceId: string,
  clinicId: string,
  performedById: string
) => {
  const provider = await getProviderById(providerId, { clinicId })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const count = await prisma.providerService.count({
    where: { providerId },
  })
  if (count <= 1) {
    const err = new Error('Provider must have at least one service') as ApiError
    err.statusCode = 400
    throw err
  }

  const existing = await prisma.providerService.findFirst({
    where: { providerId, serviceId },
  })
  if (!existing) {
    const err = new Error('Provider service assignment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const deleted = await prisma.providerService.delete({
    where: { id: existing.id },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'ProviderService',
    entityId: existing.id,
    action: 'DELETE',
    oldValue: {
      serviceId,
      priceOverride: existing.priceOverride?.toString() ?? null,
    },
    performedById,
  })

  return deleted
}

export const getProviderServices = async (providerId: string, clinicId: string) => {
  const provider = await getProviderById(providerId, { clinicId })
  if (!provider) {
    const err = new Error('Provider not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return prisma.providerService.findMany({
    where: { providerId },
    include: {
      service: {
        include: { discipline: { select: { id: true, name: true } } },
      },
    },
  })
}

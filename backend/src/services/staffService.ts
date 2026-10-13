import * as argon2 from 'argon2'
import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import * as passwordSetupService from './passwordSetupService'
import * as emailService from './emailService'
import * as auditService from './auditService'

const PLACEHOLDER_PASSWORD = 'pending-setup'

export const listFrontDeskStaff = async (clinicId: string) => {
  return prisma.user.findMany({
    where: {
      clinicId,
      role: { in: ['FRONT_DESK', 'STAFF'] },
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customRoleId: true,
      customRole: { select: { id: true, name: true } },
      isActive: true,
      createdAt: true,
    },
  })
}

export const listStaff = async (clinicId: string) => {
  return prisma.user.findMany({
    where: {
      clinicId,
      role: { not: 'PATIENT' },
      isActive: true,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customRoleId: true,
      customRole: { select: { id: true, name: true, permissions: true } },
      permissions: true,
      isActive: true,
      createdAt: true,
      provider: {
        select: {
          id: true,
          disciplines: {
            select: { discipline: { select: { name: true } } },
          },
          providerServices: {
            take: 3,
            select: { service: { select: { name: true } } },
          },
        },
      },
    },
  })
}

export const deactivateStaffUser = async (
  userId: string,
  clinicId: string,
  performedById: string
) => {
  const userToDeactivate = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, clinicId: true, role: true },
  })

  if (!userToDeactivate || userToDeactivate.clinicId !== clinicId) {
    const err = new Error('User not found') as ApiError
    err.statusCode = 404
    throw err
  }

  // PRD: Protection against removing the last Super Admin
  if (userToDeactivate.role === 'SUPER_ADMIN') {
    const adminCount = await prisma.user.count({
      where: {
        clinicId,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    })

    if (adminCount <= 1) {
      const err = new Error(
        'Cannot deactivate the last remaining Super Admin. Assign another Super Admin first.'
      ) as ApiError
      err.statusCode = 400
      throw err
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'User',
    entityId: userId,
    action: 'DEACTIVATE',
    fieldChanged: 'isActive',
    oldValue: true,
    newValue: false,
    performedById,
  })

  return updatedUser
}

export const updateStaffUser = async (
  userId: string,
  data: { role?: string; permissions?: object; customRoleId?: string },
  clinicId: string,
  performedById: string
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, clinicId: true, role: true, name: true },
  })

  if (!user || user.clinicId !== clinicId) {
    const err = new Error('User not found') as ApiError
    err.statusCode = 404
    throw err
  }

  // Prevent removing the last Super Admin
  if (user.role === 'SUPER_ADMIN' && data.role && data.role !== 'SUPER_ADMIN') {
    const adminCount = await prisma.user.count({
      where: { clinicId, role: 'SUPER_ADMIN', isActive: true },
    })
    if (adminCount <= 1) {
      const err = new Error('Cannot change role of the last remaining Super Admin.') as ApiError
      err.statusCode = 400
      throw err
    }
  }

  // If a customRoleId is provided, validate it belongs to this clinic
  if (data.customRoleId) {
    const customRole = await prisma.customRole.findUnique({
      where: { id: data.customRoleId, clinicId },
    })
    if (!customRole || customRole.clinicId !== clinicId) {
      const err = new Error('Invalid custom role') as ApiError
      err.statusCode = 400
      throw err
    }
  }

  // Determine the system role to use
  const systemRole = data.customRoleId ? 'STAFF' : ((data.role as any) ?? user.role)

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      role: systemRole,
      ...(data.customRoleId !== undefined ? { customRoleId: data.customRoleId || null } : {}),
      ...(data.permissions !== undefined ? { permissions: data.permissions as any } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customRoleId: true,
      customRole: { select: { id: true, name: true, permissions: true } },
      permissions: true,
      isActive: true,
      createdAt: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'User',
    entityId: userId,
    action: 'PERMISSION_CHANGED',
    fieldChanged: 'role/permissions',
    oldValue: { role: user.role },
    newValue: {
      role: updated.role,
      customRoleId: updated.customRoleId,
      permissions: updated.customRole?.permissions ?? updated.permissions ?? null,
    },
    performedById,
    severity: 'warning',
  })

  return updated
}

export const linkAdminAsProvider = async (
  userId: string,
  clinicId: string,
  performedById: string
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      clinicId: true,
      role: true,
      name: true,
      provider: { select: { id: true } },
    },
  })

  if (!user || user.clinicId !== clinicId) {
    const err = new Error('User not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (user.provider) {
    // Already has a provider profile — just return it
    return user.provider
  }

  // Split name into first/last
  const nameParts = (user.name ?? '').trim().split(' ')
  const firstName = nameParts[0] ?? user.name
  const lastName = nameParts.slice(1).join(' ') || firstName

  const provider = await prisma.provider.create({
    data: {
      firstName,
      lastName,
      clinicId,
      userId,
    },
    select: { id: true, firstName: true, lastName: true, userId: true },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Provider',
    entityId: provider.id,
    action: 'CREATE',
    fieldChanged: 'userId',
    oldValue: null,
    newValue: userId,
    performedById,
  })

  return provider
}

export const provisionFrontDeskUser = async (
  data: { name: string; email: string; role?: string; permissions?: object; customRoleId?: string },
  clinicId: string,
  performedById: string
) => {
  if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
    const err = new Error('SMTP is required to invite staff in production') as ApiError
    err.statusCode = 500
    throw err
  }

  const email = data.email.trim().toLowerCase()
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })

  if (existingUser) {
    const err = new Error('An account with this email already exists') as ApiError
    err.statusCode = 409
    throw err
  }

  // Determine role — if customRoleId is provided, use STAFF; otherwise fallback to legacy roles
  let assignedRole: any
  let customRoleId: string | null = null
  let roleLabelForEmail = 'Staff'

  if (data.customRoleId) {
    const customRole = await prisma.customRole.findUnique({
      where: { id: data.customRoleId, clinicId },
    })
    if (!customRole || customRole.clinicId !== clinicId) {
      const err = new Error('Invalid custom role') as ApiError
      err.statusCode = 400
      throw err
    }
    assignedRole = 'STAFF'
    customRoleId = data.customRoleId
    roleLabelForEmail = customRole.name
  } else {
    const allowedNonProviderRoles = ['FRONT_DESK', 'ACCOUNTING', 'MARKETING']
    assignedRole =
      data.role && allowedNonProviderRoles.includes(data.role) ? data.role : 'FRONT_DESK'

    const roleLabels: Record<string, string> = {
      FRONT_DESK: 'Front Desk',
      ACCOUNTING: 'Accounting',
      MARKETING: 'Marketing',
    }
    roleLabelForEmail = roleLabels[assignedRole] ?? 'Staff'
  }

  const password = await argon2.hash(PLACEHOLDER_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
  const user = await prisma.user.create({
    data: {
      name: data.name.trim(),
      email,
      password,
      role: assignedRole,
      clinicId,
      ...(customRoleId ? { customRoleId } : {}),
      ...(data.permissions ? { permissions: data.permissions as any } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customRoleId: true,
      customRole: { select: { id: true, name: true } },
      permissions: true,
      isActive: true,
      createdAt: true,
    },
  })

  const token = await passwordSetupService.createPasswordSetupToken(user.id)
  const frontendUrl = (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
  const setupLink = `${frontendUrl}/set-password?token=${token}`

  await emailService.sendStaffInviteEmail({
    to: email,
    name: user.name,
    setupLink,
    roleLabel: roleLabelForEmail,
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'User',
    entityId: user.id,
    action: 'CREATE',
    fieldChanged: 'role',
    oldValue: null,
    newValue: customRoleId ?? user.role,
    performedById,
  })

  return user
}

import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import { ALL_PERMISSION_KEYS, ROLE_PRESETS } from '../config/permissions'

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) {
    const err = new Error('Permissions must be an array of strings') as ApiError
    err.statusCode = 400
    throw err
  }
  const invalid = permissions.filter((p) => !ALL_PERMISSION_KEYS.includes(p))
  if (invalid.length > 0) {
    const err = new Error(`Invalid permissions: ${invalid.join(', ')}`) as ApiError
    err.statusCode = 400
    throw err
  }
  return permissions as string[]
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const listRoles = async (clinicId: string) => {
  const roles = await prisma.customRole.findMany({
    where: { clinicId, isActive: true },
    orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { users: true } },
    },
  })

  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isPreset: r.isPreset,
    permissions: r.permissions as string[],
    userCount: r._count.users,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

// ─── Get single ───────────────────────────────────────────────────────────────

export const getRole = async (id: string, clinicId: string) => {
  const role = await prisma.customRole.findUnique({
    where: { id, clinicId },
    include: {
      _count: { select: { users: true } },
      users: {
        where: { isActive: true },
        select: { id: true, name: true, email: true },
        take: 50,
      },
    },
  })

  if (!role || role.clinicId !== clinicId) {
    const err = new Error('Role not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isPreset: role.isPreset,
    permissions: role.permissions as string[],
    userCount: role._count.users,
    users: role.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export const createRole = async (
  data: { name: string; description?: string; permissions: unknown; presetKey?: string },
  clinicId: string
) => {
  let permissions: string[]

  // If creating from a preset, use the preset permissions as the base
  if (data.presetKey && ROLE_PRESETS[data.presetKey]) {
    permissions = [...ROLE_PRESETS[data.presetKey]!.permissions]
  } else {
    permissions = validatePermissions(data.permissions)
  }

  // Check for duplicate name
  const existing = await prisma.customRole.findUnique({
    where: { clinicId_name: { clinicId, name: data.name.trim() } },
  })
  if (existing) {
    const err = new Error(`A role named "${data.name}" already exists`) as ApiError
    err.statusCode = 409
    throw err
  }

  const role = await prisma.customRole.create({
    data: {
      clinicId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      isPreset: false,
      permissions,
    },
    include: { _count: { select: { users: true } } },
  })

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isPreset: role.isPreset,
    permissions: role.permissions as string[],
    userCount: role._count.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateRole = async (
  id: string,
  data: { name?: string; description?: string; permissions?: unknown },
  clinicId: string
) => {
  const existing = await prisma.customRole.findUnique({ where: { id, clinicId } })
  if (!existing || existing.clinicId !== clinicId) {
    const err = new Error('Role not found') as ApiError
    err.statusCode = 404
    throw err
  }

  // Check name uniqueness if name is being changed
  if (data.name && data.name.trim() !== existing.name) {
    const dup = await prisma.customRole.findUnique({
      where: { clinicId_name: { clinicId, name: data.name.trim() } },
    })
    if (dup) {
      const err = new Error(`A role named "${data.name}" already exists`) as ApiError
      err.statusCode = 409
      throw err
    }
  }

  let permissions: string[] | undefined
  if (data.permissions !== undefined) {
    permissions = validatePermissions(data.permissions)
  }

  const role = await prisma.customRole.update({
    where: { id, clinicId },
    data: {
      ...(data.name ? { name: data.name.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(permissions ? { permissions } : {}),
    },
    include: { _count: { select: { users: true } } },
  })

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isPreset: role.isPreset,
    permissions: role.permissions as string[],
    userCount: role._count.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteRole = async (id: string, clinicId: string) => {
  const role = await prisma.customRole.findUnique({
    where: { id, clinicId },
    include: { _count: { select: { users: true } } },
  })

  if (!role || role.clinicId !== clinicId) {
    const err = new Error('Role not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (role._count.users > 0) {
    const err = new Error(
      'Cannot delete a role with assigned users. Reassign them first.'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  await prisma.customRole.update({
    where: { id, clinicId },
    data: { isActive: false },
  })

  return { message: 'Role deleted' }
}

// ─── Seed presets ─────────────────────────────────────────────────────────────

/**
 * Ensures preset roles exist for a clinic (idempotent).
 * Called when a clinic is first set up or when presets are re-synced.
 */
export const seedPresetRoles = async (clinicId: string) => {
  const results = []
  for (const [name, config] of Object.entries(ROLE_PRESETS)) {
    const existing = await prisma.customRole.findUnique({
      where: { clinicId_name: { clinicId, name } },
    })
    if (!existing) {
      const role = await prisma.customRole.create({
        data: {
          clinicId,
          name,
          description: config.description,
          isPreset: true,
          permissions: config.permissions,
        },
      })
      results.push(role)
    } else {
      results.push(existing)
    }
  }
  return results
}

// ─── Get permission registry ──────────────────────────────────────────────────

export { PERMISSION_GROUPS, ALL_PERMISSION_KEYS, ROLE_PRESETS } from '../config/permissions'

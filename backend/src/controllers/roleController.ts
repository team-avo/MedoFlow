import type { Request, Response, NextFunction } from 'express'
import * as roleService from '../services/roleService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { auditPermissionChange } from './authController'

export const listRoles = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const roles = await roleService.listRoles(req.clinicId!)
    successResponse(res, 200, 'Roles retrieved', { roles })
  }
)

export const getRole = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const role = await roleService.getRole(id, req.clinicId!)
    successResponse(res, 200, 'Role retrieved', { role })
  }
)

export const createRole = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { name, description, permissions, presetKey } = req.body as {
      name: string
      description?: string
      permissions: unknown
      presetKey?: string
    }
    const role = await roleService.createRole(
      { name, description, permissions, presetKey },
      req.clinicId!
    )
    await auditPermissionChange(req, {
      clinicId: req.clinicId!,
      entityType: 'CustomRole',
      entityId: role.id,
      oldValue: null,
      newValue: { name: role.name, permissions: role.permissions },
    })
    successResponse(res, 201, 'Role created', { role })
  }
)

export const updateRole = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const { name, description, permissions } = req.body as {
      name?: string
      description?: string
      permissions?: unknown
    }
    const before = await roleService.getRole(id, req.clinicId!)
    const role = await roleService.updateRole(id, { name, description, permissions }, req.clinicId!)
    await auditPermissionChange(req, {
      clinicId: req.clinicId!,
      entityType: 'CustomRole',
      entityId: id,
      oldValue: { name: before.name, permissions: before.permissions },
      newValue: { name: role.name, permissions: role.permissions },
    })
    successResponse(res, 200, 'Role updated', { role })
  }
)

export const deleteRole = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const before = await roleService.getRole(id, req.clinicId!)
    const result = await roleService.deleteRole(id, req.clinicId!)
    await auditPermissionChange(req, {
      clinicId: req.clinicId!,
      entityType: 'CustomRole',
      entityId: id,
      oldValue: { name: before.name, permissions: before.permissions },
      newValue: null,
    })
    successResponse(res, 200, result.message)
  }
)

export const seedPresets = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const roles = await roleService.seedPresetRoles(req.clinicId!)
    successResponse(res, 200, 'Preset roles synced', { roles })
  }
)

export const getPermissionRegistry = asyncHandler(
  (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { PERMISSION_GROUPS, ROLE_PRESETS } = roleService
    successResponse(res, 200, 'Permission registry', {
      groups: PERMISSION_GROUPS,
      presets: ROLE_PRESETS,
    })
    return Promise.resolve()
  }
)

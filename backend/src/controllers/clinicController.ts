import type { Request, Response, NextFunction } from 'express'
import * as clinicService from '../services/clinicService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'

export const getCurrent = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinic = await clinicService.getClinicForUser(req.user!.id)
    successResponse(res, 200, 'Clinic retrieved', { clinic })
  }
)

export const setup = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinic = await clinicService.setupClinicForSuperAdmin(
      req.user!.id,
      req.body as Parameters<typeof clinicService.setupClinicForSuperAdmin>[1]
    )
    successResponse(res, 201, 'Clinic setup completed', { clinic })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }

    const clinic = await clinicService.updateClinic(
      clinicId,
      req.body as clinicService.UpdateClinicData,
      req.user!.id
    )
    successResponse(res, 200, 'Clinic updated', { clinic })
  }
)

export const generateWebsite = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await clinicService.generateWebsite(
      clinicId,
      req.body as clinicService.GenerateWebsiteData,
      req.user!.id
    )
    successResponse(res, 200, 'Website generated', result)
  }
)

export const upsertLaunchLocation = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }

    const location = await clinicService.upsertLaunchLocation(
      clinicId,
      req.body as clinicService.UpsertLaunchLocationData,
      req.user!.id
    )
    successResponse(res, 200, 'Launch location saved', { location })
  }
)

import type { Request, Response, NextFunction } from 'express'
import * as locationService from '../services/locationService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere } from '../middleware/clinicScope'

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const location = await locationService.createLocation(
      req.body as locationService.CreateLocationData,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Location created', { location })
  }
)

export const list = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const where = getClinicWhere(req)
    const locations = await locationService.getLocations(where)
    successResponse(res, 200, 'Locations retrieved', { locations })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const location = await locationService.updateLocation(
      String(req.params.id),
      req.body as locationService.UpdateLocationData,
      req.user!.clinicId!,
      req.user!.id
    )
    successResponse(res, 200, 'Location updated', { location })
  }
)

/** DELETE /locations/:id (CTO-34): deactivate a location with nothing booked there. */
export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const result = await locationService.removeLocation(
      String(req.params.id),
      req.user!.clinicId!,
      req.user!.id
    )
    successResponse(res, 200, 'Location removed', result)
  }
)

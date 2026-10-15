import type { Request, Response, NextFunction } from 'express'
import * as providerService from '../services/providerService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere, assertClinicAccess } from '../middleware/clinicScope'
import type { ApiError } from '../types/errors'

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const provider = await providerService.createProvider(
      req.body as providerService.CreateProviderData,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Provider created', { provider })
  }
)

export const list = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const where = getClinicWhere(req)
    const providers = await providerService.getProviders(where)
    successResponse(res, 200, 'Providers retrieved', { providers })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const provider = await providerService.getProviderById(id)
    if (!provider) {
      const err = new Error('Provider not found') as ApiError
      err.statusCode = 404
      throw err
    }
    assertClinicAccess(req, provider.clinicId)
    successResponse(res, 200, 'Provider retrieved', { provider })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const provider = await providerService.updateProvider(
      id,
      req.body as Parameters<typeof providerService.updateProvider>[1],
      where,
      req.user!.id
    )
    successResponse(res, 200, 'Provider updated', { provider })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const provider = await providerService.softDeleteProvider(id, where, req.user!.id)
    successResponse(res, 200, 'Provider deactivated', { provider })
  }
)

export const addService = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const clinicId = req.user!.clinicId!
    const body = req.body as {
      serviceId: string
      priceOverride?: number | string | null
    }
    const assignment = await providerService.addProviderService(
      id,
      body.serviceId,
      body.priceOverride,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Service assigned to provider', {
      providerService: assignment,
    })
  }
)

export const updateService = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const serviceId = req.params.serviceId as string
    const clinicId = req.user!.clinicId!
    const { priceOverride } = req.body as { priceOverride?: number | string | null }
    const assignment = await providerService.updateProviderService(
      id,
      serviceId,
      priceOverride,
      clinicId,
      req.user!.id
    )
    successResponse(res, 200, 'Provider service updated', {
      providerService: assignment,
    })
  }
)

export const removeService = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const serviceId = req.params.serviceId as string
    const clinicId = req.user!.clinicId!
    await providerService.removeProviderService(id, serviceId, clinicId, req.user!.id)
    successResponse(res, 200, 'Service removed from provider')
  }
)

export const listServices = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const clinicId = req.user!.clinicId!
    const providerServices = await providerService.getProviderServices(id, clinicId)
    successResponse(res, 200, 'Provider services retrieved', {
      providerServices,
    })
  }
)

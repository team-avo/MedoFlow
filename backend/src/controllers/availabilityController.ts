import type { Request, Response, NextFunction } from 'express'
import * as availabilityService from '../services/availabilityService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'

export const getProviderAvailability = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const providerId = req.params.id as string
    const date = req.query.date as string
    const serviceId = req.query.serviceId as string | undefined
    const locationId = req.query.locationId as string | undefined
    const serviceDuration = req.query.serviceDuration as string

    if (!date || !serviceDuration || !serviceId) {
      const err = new Error('date, serviceId, and serviceDuration are required') as ApiError
      err.statusCode = 400
      throw err
    }

    const serviceDurationMinutes = parseInt(serviceDuration, 10)
    if (isNaN(serviceDurationMinutes) || serviceDurationMinutes <= 0) {
      const err = new Error('serviceDuration must be a positive number') as ApiError
      err.statusCode = 400
      throw err
    }

    // Mounted before `protect` in routes/providers.ts (unauthenticated, no
    // tenant context): resolve the provider's clinic publicly, then compute
    // slots scoped to that clinic.
    const provider = await withTenantBypass('public:provider_availability', () =>
      prisma.provider.findFirst({
        where: { id: providerId, isActive: true },
        select: { clinicId: true },
      })
    )
    if (!provider) {
      const err = new Error('Provider not found') as ApiError
      err.statusCode = 404
      throw err
    }

    const clinicId = req.clinicId ?? provider.clinicId

    const slots = await withTenantBypass('public:provider_availability', () =>
      availabilityService.getAvailableSlots({
        providerId,
        serviceId,
        locationId: locationId ?? null,
        serviceDurationMinutes,
        date,
        clinicId: clinicId ?? undefined,
      })
    )

    successResponse(res, 200, 'Availability retrieved', { slots })
  }
)

export const previewAvailabilityUpdate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const providerId = req.params.id as string
    const { weekday, startTime, endTime } = req.body as {
      weekday?: number | string
      startTime?: string
      endTime?: string
    }
    if (weekday === undefined || startTime === undefined || endTime === undefined) {
      const err = new Error('weekday, startTime and endTime are required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await availabilityService.previewAvailabilityUpdate({
      providerId,
      weekday: Number(weekday),
      newStartTime: String(startTime),
      newEndTime: String(endTime),
    })
    successResponse(res, 200, 'Availability impact preview', result)
  }
)

export const createAvailability = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const providerId = req.params.id as string
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const availability = await availabilityService.createAvailability(
      {
        ...(req.body as Omit<availabilityService.CreateAvailabilityData, 'providerId'>),
        providerId,
      },
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Availability created', { availability })
  }
)

export const updateAvailability = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.availabilityId as string
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const { force, ...data } = req.body as {
      force?: boolean
      weekday?: number
      startTime?: string
      endTime?: string
    }
    const result = await availabilityService.updateAvailability(id, data, clinicId, req.user!.id, {
      force: Boolean(force),
    })
    if ('requiresConfirmation' in result && result.requiresConfirmation) {
      successResponse(res, 200, 'Confirmation required', {
        requiresConfirmation: true,
        affectedCount: result.affectedCount,
        affectedAppointmentIds: result.affectedAppointmentIds,
      })
      return
    }
    successResponse(res, 200, 'Availability updated', { availability: result })
  }
)

export const createUnavailability = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const providerId = req.params.id as string
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const unavailability = await availabilityService.createUnavailability(
      {
        ...(req.body as Omit<availabilityService.CreateUnavailabilityData, 'providerId'>),
        providerId,
      },
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Unavailability created', { unavailability })
  }
)

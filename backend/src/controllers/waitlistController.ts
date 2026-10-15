import type { Request, Response, NextFunction } from 'express'
import * as waitlistService from '../services/waitlistService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'

export const add = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const body = req.body as {
      clinicId?: string
      patientId?: string
      preferredDate?: string | Date
      preferredStartTime?: string
      preferredEndTime?: string
      providerId?: string
      serviceId?: string
      locationId?: string
      timezone?: string
    }
    const clinicId = (req.clinicId ?? body.clinicId) as string
    if (!clinicId) {
      const err = new Error('clinicId is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const patientId = (body.patientId as string) || req.user!.id
    if (patientId !== req.user!.id) {
      const err = new Error('You can only add yourself to the waitlist') as ApiError
      err.statusCode = 403
      throw err
    }
    const preferredDate = body.preferredDate as string | Date
    const preferredStartTime = body.preferredStartTime as string
    const preferredEndTime = body.preferredEndTime as string
    const providerId = body.providerId as string
    const serviceId = body.serviceId as string
    const locationId = body.locationId
    const timezone = body.timezone ?? 'UTC'

    if (!providerId || !serviceId || !preferredDate || !preferredStartTime || !preferredEndTime) {
      const err = new Error(
        'clinicId, providerId, serviceId, preferredDate, preferredStartTime, and preferredEndTime are required'
      ) as ApiError
      err.statusCode = 400
      throw err
    }

    const entry = await waitlistService.addToWaitlist(
      {
        clinicId,
        providerId,
        serviceId,
        patientId,
        preferredLocationId: locationId ?? null,
        timezone,
        preferredDate: new Date(preferredDate),
        preferredStartTime,
        preferredEndTime,
      },
      req.user!.id
    )
    successResponse(res, 201, 'Added to waitlist', { entry })
  }
)

export const getMy = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user?.clinicId ?? undefined
    const entries = await waitlistService.getMyWaitlistEntries(req.user!.id, clinicId ?? null)
    successResponse(res, 200, 'Waitlist entries retrieved', { entries })
  }
)

export const claim = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const { entry, appointment } = await waitlistService.claimWaitlistOffer(
      id,
      req.user!.id,
      req.user!.id
    )
    successResponse(res, 200, 'Slot claimed and appointment created', {
      entry,
      appointment,
    })
  }
)

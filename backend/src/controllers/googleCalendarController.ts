import type { Request, Response, NextFunction } from 'express'
import * as googleCalendarService from '../services/googleCalendarService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'

export const getAuthUrl = asyncHandler(
  (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const redirectUri = req.query.redirectUri as string
    if (!redirectUri) {
      const err = new Error('redirectUri is required') as ApiError
      err.statusCode = 400
      return Promise.reject(err)
    }
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      return Promise.reject(err)
    }
    const result = googleCalendarService.getGoogleAuthUrl(redirectUri, req.user!.id, clinicId)
    successResponse(res, 200, 'Google auth URL generated', result)
    return Promise.resolve()
  }
)

export const connect = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { code, redirectUri, state } = req.body as {
      code?: string
      redirectUri?: string
      state?: string
    }
    if (!code || !redirectUri) {
      const err = new Error('code and redirectUri are required') as ApiError
      err.statusCode = 400
      throw err
    }
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    // Validate OAuth state to prevent CSRF (state must match current user/clinic)
    if (!state) {
      const err = new Error('OAuth state is required') as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8')) as {
        userId?: string
        clinicId?: string
      }
      if (decoded.userId !== req.user!.id || decoded.clinicId !== clinicId) {
        const err = new Error('Invalid OAuth state') as ApiError
        err.statusCode = 400
        err.code = 'validation_error'
        throw err
      }
    } catch (e) {
      if ((e as ApiError).statusCode === 400) throw e
      const err = new Error('Invalid OAuth state') as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    const connection = await googleCalendarService.connectGoogleCalendar(
      req.user!.id,
      clinicId,
      code,
      redirectUri
    )
    successResponse(res, 200, 'Google Calendar connected', { connection })
  }
)

export const syncEvents = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const { redirectUri, days } = req.body as { redirectUri?: string; days?: number }
    if (!redirectUri) {
      const err = new Error('redirectUri is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await googleCalendarService.syncUpcomingMeetEvents(
      req.user!.id,
      clinicId,
      redirectUri,
      days
    )
    successResponse(res, 200, 'Google Calendar events synced', result)
  }
)

export const listEvents = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const events = await googleCalendarService.listMeetEvents(req.user!.id, clinicId)
    successResponse(res, 200, 'Meeting events retrieved', { events })
  }
)

export const status = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const status = await googleCalendarService.getConnectionStatus(req.user!.id, clinicId)
    successResponse(res, 200, 'Google Calendar connection status', { status })
  }
)

export const disconnect = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await googleCalendarService.disconnectGoogleCalendar(req.user!.id, clinicId)
    successResponse(res, 200, 'Google Calendar disconnected', result)
  }
)

export const startScribeFromMeeting = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const eventId = req.params.eventId as string
    const result = await googleCalendarService.startScribeFromMeeting(
      req.user!.id,
      clinicId,
      eventId
    )
    successResponse(res, 200, 'AI Scribe session started from meeting', result)
  }
)

export const listEventAppointmentCandidates = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const eventId = req.params.eventId as string
    const appointments = await googleCalendarService.listAppointmentCandidatesForEvent(
      req.user!.id,
      clinicId,
      eventId
    )
    successResponse(res, 200, 'Appointment candidates retrieved', {
      appointments,
    })
  }
)

export const linkEventToAppointment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const eventId = req.params.eventId as string
    const { appointmentId } = req.body as { appointmentId?: string }
    if (!appointmentId) {
      const err = new Error('appointmentId is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const event = await googleCalendarService.linkEventToAppointment(
      req.user!.id,
      clinicId,
      eventId,
      appointmentId
    )
    successResponse(res, 200, 'Meeting event linked to appointment', { event })
  }
)

import { Request, Response, NextFunction } from 'express'
import prisma from '../config/prisma'
import * as appointmentService from '../services/appointmentService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere } from '../middleware/clinicScope'
import { ApiError } from '../types/errors'
import { BookingSource } from '@prisma/client'

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId ?? (req.body?.clinicId as string)
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const { patientId, slotHoldId, patientPackageId, ...rest } = req.body
    const resolvedPatientId = (patientId as string) || req.user!.id
    const bookingSource =
      req.user!.role === 'FRONT_DESK'
        ? BookingSource.FRONT_DESK
        : req.user!.role === 'PATIENT'
          ? BookingSource.PATIENT_PORTAL
          : BookingSource.PUBLIC
    const result = await appointmentService.createAppointment(
      { ...rest, patientId: resolvedPatientId },
      clinicId,
      {
        performedById: req.user!.id,
        slotHoldId: slotHoldId as string | undefined,
        patientPackageId: patientPackageId as string | undefined,
        bookingSource,
      }
    )
    successResponse(res, 201, 'Appointment created', result)
  }
)

export const createRecurring = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId ?? (req.body?.clinicId as string)
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const resolvedPatientId = (req.body.patientId as string) || req.user!.id
    const {
      locationId,
      providerId,
      serviceId,
      startTime,
      endTime,
      frequency,
      numberOfSessions,
      endDate,
    } = req.body
    if (!providerId || !serviceId || !startTime || !endTime || frequency !== 'WEEKLY') {
      const err = new Error(
        'providerId, serviceId, startTime, endTime, and frequency (WEEKLY) are required'
      ) as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await appointmentService.createRecurringSeries(
      {
        clinicId,
        locationId: locationId ?? undefined,
        providerId,
        serviceId,
        patientId: resolvedPatientId,
        firstStartTime: startTime,
        firstEndTime: endTime,
        frequency: 'WEEKLY',
        numberOfSessions: numberOfSessions != null ? Number(numberOfSessions) : undefined,
        endDate: endDate ?? null,
      },
      req.user!.id
    )
    successResponse(res, 201, 'Recurring series created', {
      appointments: result.appointments,
      conflicts: result.conflicts,
    })
  }
)

export const getMy = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined
    const options =
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    const appointments = await appointmentService.getAppointmentsByPatient(
      req.user!.id,
      clinicId,
      options
    )
    successResponse(res, 200, 'Appointments retrieved', { appointments })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where: { patientId?: string; clinicId?: string } = {}
    if (req.user!.role === 'PATIENT') {
      where.patientId = req.user!.id
    } else if (req.clinicId) {
      where.clinicId = req.clinicId
    }
    const appointment = await appointmentService.getAppointmentById(id, where)
    if (!appointment) {
      const err = new Error('Appointment not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const event = await prisma.googleCalendarEvent.findFirst({
      where: { appointmentId: id, clinicId: appointment.clinicId },
      select: { meetLink: true },
    })
    const payload = {
      ...appointment,
      meetLink: event?.meetLink ?? null,
    }
    successResponse(res, 200, 'Appointment retrieved', { appointment: payload })
  }
)

const getTimelineWhere = async (
  req: Request
): Promise<{ clinicId?: string; patientId?: string; providerId?: string }> => {
  if (req.user!.role === 'PATIENT') return { patientId: req.user!.id }
  if (req.user!.role === 'PROVIDER') {
    const provider = await appointmentService.getProviderByUserId(req.user!.id)
    if (provider) return { providerId: provider.id }
  }
  if (req.clinicId) return { clinicId: req.clinicId }
  return {}
}

export const getTimeline = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = await getTimelineWhere(req)
    const result = await appointmentService.getAppointmentTimeline(id, where)
    successResponse(res, 200, 'Appointment timeline retrieved', result)
  }
)

export const getByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    const clinicId = req.clinicId!
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined
    const options =
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    const appointments = await appointmentService.getAppointmentsByPatient(
      patientId,
      clinicId,
      options
    )
    successResponse(res, 200, 'Appointments retrieved', { appointments })
  }
)

export const getProvider = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const provider = await appointmentService.getProviderByUserId(req.user!.id)
    if (!provider) {
      const err = new Error('Provider profile not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const clinicId = req.clinicId!
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined
    const options =
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    const appointments = await appointmentService.getAppointmentsByProvider(
      provider.id,
      clinicId,
      options
    )
    successResponse(res, 200, 'Appointments retrieved', { appointments })
  }
)

export const getClinic = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined
    const options =
      startDate && endDate
        ? { startDate: new Date(startDate), endDate: new Date(endDate) }
        : undefined
    const appointments = await appointmentService.getAppointmentsByClinic(clinicId, options)
    successResponse(res, 200, 'Appointments retrieved', { appointments })
  }
)

export const updateStatus = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const { status } = req.body
    if (!status) {
      const err = new Error('Status is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const validStatuses: string[] = [
      'DRAFT',
      'PENDING_PAYMENT',
      'CONFIRMED',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'RESCHEDULED',
    ]
    if (!validStatuses.includes(status as string)) {
      const err = new Error('Invalid status') as ApiError
      err.statusCode = 400
      throw err
    }
    const appointment = await appointmentService.updateAppointmentStatus(
      id,
      status as import('@prisma/client').AppointmentStatus,
      req
    )
    successResponse(res, 200, 'Appointment status updated', { appointment })
  }
)

const getCancelRescheduleWhere = async (
  req: Request
): Promise<{ clinicId?: string; patientId?: string; providerId?: string }> => {
  if (req.user!.role === 'PATIENT') return { patientId: req.user!.id }
  if (req.user!.role === 'PROVIDER') {
    const provider = await appointmentService.getProviderByUserId(req.user!.id)
    if (provider) return { providerId: provider.id }
  }
  if ((req.user!.role === 'FRONT_DESK' || req.user!.role === 'SUPER_ADMIN') && req.clinicId)
    return { clinicId: req.clinicId }
  return {}
}

export const cancel = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const { reason } = req.body
    const reasonStr = (reason as string)?.trim() ?? ''
    const where = await getCancelRescheduleWhere(req)
    const result = await appointmentService.cancelAppointment(id, reasonStr, req.user!.id, where)
    successResponse(res, 200, 'Appointment cancelled', {
      appointment: result.appointment,
      lateCancellation: result.lateCancellation,
      cancellationFee: result.cancellationFee,
    })
  }
)

export const reschedule = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const { newStartTime, newEndTime } = req.body
    if (!newStartTime || !newEndTime) {
      const err = new Error('newStartTime and newEndTime are required') as ApiError
      err.statusCode = 400
      throw err
    }
    const where = await getCancelRescheduleWhere(req)
    const result = await appointmentService.rescheduleAppointment(
      id,
      {
        newStartTime,
        newEndTime,
        locationId: req.body.locationId as string | undefined,
        slotHoldId: req.body.slotHoldId as string | undefined,
      },
      req.user!.id,
      where
    )
    successResponse(res, 200, 'Appointment rescheduled', {
      oldAppointment: result.oldAppointment,
      newAppointment: result.newAppointment,
    })
  }
)

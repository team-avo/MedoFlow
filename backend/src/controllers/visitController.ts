import type { Request, Response, NextFunction } from 'express'
import * as visitService from '../services/visitService'
import * as aiScribeService from '../services/aiScribeService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { sanitizeVisitRecordForPatient } from '../utils/visitSanitize'
import type { ApiError } from '../types/errors'
import { logRead } from '../services/auditService'

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const provider = await visitService.getProviderByUserId(req.user!.id)
    if (!provider) {
      const err = new Error('Provider profile not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const visitRecord = await visitService.createVisitRecord(
      req.body as visitService.CreateVisitRecordData,
      provider.id,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Visit record created', { visitRecord })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const clinicId = req.clinicId
    const includeHistory = req.query.includeHistory === 'true'
    const visitRecord = await visitService.getVisitRecordById(
      id,
      clinicId ? { clinicId } : {},
      includeHistory
    )
    if (!visitRecord) {
      const err = new Error('Visit record not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (req.user?.role === 'PROVIDER') {
      const provider = await visitService.getProviderByUserId(req.user.id)
      if (!provider || visitRecord.providerId !== provider.id) {
        const err = new Error('Access denied') as ApiError
        err.statusCode = 403
        throw err
      }
    }
    if (req.user?.role === 'PATIENT' && visitRecord.patientId !== req.user.id) {
      const err = new Error('Access denied') as ApiError
      err.statusCode = 403
      throw err
    }
    const safeVisitRecord =
      req.user?.role === 'PATIENT'
        ? sanitizeVisitRecordForPatient(visitRecord as unknown as Record<string, unknown>)
        : visitRecord
    let payload: {
      visitRecord: typeof visitRecord | Record<string, unknown>
      patientSummary?: object
    } = {
      visitRecord: safeVisitRecord,
    }
    if (req.user?.role === 'PATIENT' && visitRecord.isFinalized) {
      const patientSummary = await aiScribeService.getPublishedPatientSummary(
        visitRecord.id,
        visitRecord.patientId
      )
      if (patientSummary) {
        payload = { ...payload, patientSummary }
      }
    }
    await logRead(req, {
      entityType: 'VisitRecord',
      entityId: visitRecord.id,
      clinicId: visitRecord.clinicId,
    })
    successResponse(res, 200, 'Visit record retrieved', payload)
  }
)

export const getByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const visitRecords = await visitService.getVisitRecordsByPatient(patientId, clinicId)
    for (const v of visitRecords) {
      await logRead(req, { entityType: 'VisitRecord', entityId: v.id, clinicId: v.clinicId })
    }
    successResponse(res, 200, 'Visit records retrieved', { visitRecords })
  }
)

export const getByAppointment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    const clinicId = req.clinicId
    const includeHistory = req.query.includeHistory === 'true'
    const visitRecord = await visitService.getVisitRecordByAppointment(
      appointmentId,
      clinicId,
      includeHistory
    )
    if (!visitRecord) {
      const err = new Error('Visit record not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (req.user?.role === 'PROVIDER') {
      const provider = await visitService.getProviderByUserId(req.user.id)
      if (!provider || visitRecord.providerId !== provider.id) {
        const err = new Error('Access denied') as ApiError
        err.statusCode = 403
        throw err
      }
    }
    if (req.user?.role === 'PATIENT' && visitRecord.patientId !== req.user.id) {
      const err = new Error('Access denied') as ApiError
      err.statusCode = 403
      throw err
    }
    const safeVisitRecord =
      req.user?.role === 'PATIENT'
        ? sanitizeVisitRecordForPatient(visitRecord as unknown as Record<string, unknown>)
        : visitRecord
    let payload: {
      visitRecord: typeof visitRecord | Record<string, unknown>
      patientSummary?: object
    } = {
      visitRecord: safeVisitRecord,
    }
    if (req.user?.role === 'PATIENT' && visitRecord.isFinalized) {
      const patientSummary = await aiScribeService.getPublishedPatientSummary(
        visitRecord.id,
        visitRecord.patientId
      )
      if (patientSummary) {
        payload = { ...payload, patientSummary }
      }
    }
    await logRead(req, {
      entityType: 'VisitRecord',
      entityId: visitRecord.id,
      clinicId: visitRecord.clinicId,
    })
    successResponse(res, 200, 'Visit record retrieved', payload)
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const provider = await visitService.getProviderByUserId(req.user!.id)
    if (!provider) {
      const err = new Error('Provider profile not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const visitRecord = await visitService.updateVisitRecord(
      id,
      req.body as visitService.UpdateVisitRecordData,
      provider.id,
      clinicId,
      req.user!.id
    )
    successResponse(res, 200, 'Visit record updated', { visitRecord })
  }
)

export const finalize = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const provider = await visitService.getProviderByUserId(req.user!.id)
    if (!provider) {
      const err = new Error('Provider profile not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const visitRecord = await visitService.finalizeVisitRecord(
      id,
      provider.id,
      clinicId,
      req.user!.id
    )
    successResponse(res, 200, 'Visit record finalized', { visitRecord })
  }
)

export const listClinic = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const visitRecords = await visitService.getVisitRecordsByClinic(clinicId)
    successResponse(res, 200, 'Visit records retrieved', { visitRecords })
  }
)

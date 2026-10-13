import type { Request, Response, NextFunction } from 'express'
import * as prescriptionService from '../services/prescriptionService'
import * as visitService from '../services/visitService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'

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
    const prescription = await prescriptionService.createPrescription(
      req.body as prescriptionService.CreatePrescriptionData,
      provider.id,
      clinicId
    )
    successResponse(res, 201, 'Prescription created', { prescription })
  }
)

export const getMy = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId ?? req.user?.clinicId
    const prescriptions = await prescriptionService.getPrescriptionsByPatient(
      req.user!.id,
      clinicId
    )
    successResponse(res, 200, 'Prescriptions retrieved', { prescriptions })
  }
)

export const getByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    const clinicId = req.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const prescriptions = await prescriptionService.getPrescriptionsByPatient(patientId, clinicId)
    successResponse(res, 200, 'Prescriptions retrieved', { prescriptions })
  }
)

export const getProvider = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const provider = await visitService.getProviderByUserId(req.user!.id)
    if (!provider) {
      const err = new Error('Provider profile not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const clinicId = req.clinicId!
    const prescriptions = await prescriptionService.getPrescriptionsByProvider(
      provider.id,
      clinicId
    )
    successResponse(res, 200, 'Prescriptions retrieved', { prescriptions })
  }
)

export const listClinic = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const prescriptions = await prescriptionService.getPrescriptionsByClinic(clinicId)
    successResponse(res, 200, 'Prescriptions retrieved', { prescriptions })
  }
)

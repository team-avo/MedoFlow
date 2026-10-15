import type { Request, Response, NextFunction } from 'express'
import * as treatmentPlanService from '../services/treatmentPlanService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere } from '../middleware/clinicScope'
import type { ApiError } from '../types/errors'

const getUpdateWhere = async (req: Request): Promise<{ clinicId: string; providerId?: string }> => {
  const clinicId = req.user!.clinicId!
  const where: { clinicId: string; providerId?: string } = { clinicId }
  if (req.user!.role === 'PROVIDER') {
    const provider = await treatmentPlanService.getProviderByUserId(req.user!.id)
    if (provider) where.providerId = provider.id
  }
  return where
}

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    const body = { ...(req.body as treatmentPlanService.CreateTreatmentPlanData) }
    if (req.user!.role === 'PROVIDER' && !body.providerId) {
      const provider = await treatmentPlanService.getProviderByUserId(req.user!.id)
      if (provider) body.providerId = provider.id
    }
    const plan = await treatmentPlanService.createTreatmentPlan(body, clinicId, req.user!.id)
    successResponse(res, 201, 'Treatment plan created', { treatmentPlan: plan })
  }
)

export const getList = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    if (!clinicId) {
      const err = new Error('Clinic ID is required') as ApiError
      err.statusCode = 400
      throw err
    }
    let providerId: string | undefined
    if (req.user!.role === 'PROVIDER') {
      const provider = await treatmentPlanService.getProviderByUserId(req.user!.id)
      if (provider) providerId = provider.id
    }
    const status = req.query.status as 'ACTIVE' | 'COMPLETED' | 'DISCONTINUED' | undefined
    const plans = await treatmentPlanService.getTreatmentPlans({
      clinicId,
      providerId,
      status,
    })
    successResponse(res, 200, 'Treatment plans retrieved', { treatmentPlans: plans })
  }
)

export const getByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    const where = getClinicWhere(req)
    if (!where.clinicId) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }
    const plans = await treatmentPlanService.getTreatmentPlansByPatient(patientId, where.clinicId)
    successResponse(res, 200, 'Treatment plans retrieved', { treatmentPlans: plans })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const whereClause = where.clinicId ? { clinicId: where.clinicId } : {}
    const plan = await treatmentPlanService.getTreatmentPlanById(id, whereClause)
    if (!plan) {
      const err = new Error('Treatment plan not found') as ApiError
      err.statusCode = 404
      throw err
    }
    successResponse(res, 200, 'Treatment plan retrieved', { treatmentPlan: plan })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const updateWhere = await getUpdateWhere(req)
    const plan = await treatmentPlanService.getTreatmentPlanById(id, updateWhere)
    if (!plan) {
      const err = new Error('Treatment plan not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (
      req.user!.role === 'PROVIDER' &&
      updateWhere.providerId &&
      plan.providerId !== updateWhere.providerId
    ) {
      const err = new Error('Only the assigned provider can update this plan') as ApiError
      err.statusCode = 403
      throw err
    }
    const updated = await treatmentPlanService.updateTreatmentPlan(
      id,
      req.body as treatmentPlanService.UpdateTreatmentPlanData,
      req.user!.id,
      updateWhere
    )
    successResponse(res, 200, 'Treatment plan updated', { treatmentPlan: updated })
  }
)

export const complete = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const updateWhere = await getUpdateWhere(req)
    const plan = await treatmentPlanService.getTreatmentPlanById(id, updateWhere)
    if (!plan) {
      const err = new Error('Treatment plan not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (
      req.user!.role === 'PROVIDER' &&
      updateWhere.providerId &&
      plan.providerId !== updateWhere.providerId
    ) {
      const err = new Error('Only the assigned provider can complete this plan') as ApiError
      err.statusCode = 403
      throw err
    }
    const updated = await treatmentPlanService.completeTreatmentPlan(id, req.user!.id, updateWhere)
    successResponse(res, 200, 'Treatment plan completed', { treatmentPlan: updated })
  }
)

export const discontinue = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const updateWhere = await getUpdateWhere(req)
    const plan = await treatmentPlanService.getTreatmentPlanById(id, updateWhere)
    if (!plan) {
      const err = new Error('Treatment plan not found') as ApiError
      err.statusCode = 404
      throw err
    }
    if (
      req.user!.role === 'PROVIDER' &&
      updateWhere.providerId &&
      plan.providerId !== updateWhere.providerId
    ) {
      const err = new Error('Only the assigned provider can discontinue this plan') as ApiError
      err.statusCode = 403
      throw err
    }
    const updated = await treatmentPlanService.discontinueTreatmentPlan(
      id,
      req.user!.id,
      updateWhere
    )
    successResponse(res, 200, 'Treatment plan discontinued', { treatmentPlan: updated })
  }
)

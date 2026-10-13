import { Request, Response, NextFunction } from 'express'
import * as commissionService from '../services/commissionService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import prisma from '../config/prisma'

export const getRules = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const includeInactive = req.query.includeInactive === 'true'
    const rules = await commissionService.getRules(clinicId, { includeInactive })
    successResponse(res, 200, 'Commission rules retrieved', { rules })
  }
)

export const createRule = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const rule = await commissionService.createRule(clinicId, req.body)
    successResponse(res, 201, 'Commission rule created', { rule })
  }
)

export const toggleRule = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const rule = await commissionService.updateRule(id, clinicId, req.body)
    successResponse(res, 200, 'Commission rule updated', { rule })
  }
)

export const getRecords = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    let providerId: string | undefined = undefined

    if (req.user?.role === 'PROVIDER') {
      const provider = await prisma.provider.findUnique({
        where: { userId: req.user.id, clinicId },
      })
      providerId = provider?.id
    } else if (req.query.providerId) {
      providerId = String(req.query.providerId)
    }

    const status = req.query.status ? (String(req.query.status).toUpperCase() as any) : undefined
    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined

    const { records, summary } = await commissionService.getRecords(clinicId, {
      providerId,
      status,
      dateFrom,
      dateTo,
    })
    successResponse(res, 200, 'Commission records retrieved', { records, summary })
  }
)

export const markAsPaid = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const { recordIds } = req.body

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      const err = new Error('recordIds array is required') as any
      err.statusCode = 400
      throw err
    }

    await commissionService.markPaid(clinicId, recordIds)
    successResponse(res, 200, 'Commission records marked as paid')
  }
)

import type { Request, Response, NextFunction } from 'express'
import * as commissionService from '../services/commissionService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import prisma from '../config/prisma'
import type { CommissionStatus } from '@prisma/client'
import type { ApiError } from '../types/errors'

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

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
    const rule = await commissionService.createRule(
      clinicId,
      req.body as commissionService.CreateRuleInput
    )
    successResponse(res, 201, 'Commission rule created', { rule })
  }
)

export const toggleRule = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const id = req.params.id as string
    const rule = await commissionService.updateRule(
      id,
      clinicId,
      req.body as Partial<commissionService.CreateRuleInput>
    )
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
      providerId = queryString(req.query.providerId)
    }

    const statusParam = queryString(req.query.status)
    const dateFromParam = queryString(req.query.dateFrom)
    const dateToParam = queryString(req.query.dateTo)
    const status = statusParam ? (statusParam.toUpperCase() as CommissionStatus) : undefined
    const dateFrom = dateFromParam ? new Date(dateFromParam) : undefined
    const dateTo = dateToParam ? new Date(dateToParam) : undefined

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
    const { recordIds } = req.body as { recordIds?: unknown }

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      const err = new Error('recordIds array is required') as ApiError
      err.statusCode = 400
      throw err
    }

    await commissionService.markPaid(clinicId, recordIds as string[])
    successResponse(res, 200, 'Commission records marked as paid')
  }
)

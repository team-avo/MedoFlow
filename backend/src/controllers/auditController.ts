import type { Request, Response, NextFunction } from 'express'
import * as auditService from '../services/auditService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

export const listLogs = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.clinicId!
    const limit = parseInt(req.query.limit as string) || 100
    const offset = parseInt(req.query.offset as string) || 0

    const [logs, total] = await Promise.all([
      auditService.listAuditLogs(clinicId, limit, offset),
      auditService.countAuditLogs(clinicId),
    ])

    successResponse(res, 200, 'Audit logs retrieved', { logs, total })
  }
)

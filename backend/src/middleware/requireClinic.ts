import type { Request, Response, NextFunction } from 'express'
import type { ApiError } from '../types/errors'

/**
 * Phase 1: Users belong to exactly one clinic.
 * Ensures req.user.clinicId exists. Use on routes that require clinic-scoped data.
 */
export const requireClinic = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    const err = new Error('Authentication required') as ApiError
    err.statusCode = 401
    next(err)
    return
  }

  if (!req.user.clinicId) {
    const err = new Error('User is not assigned to a clinic') as ApiError
    err.statusCode = 403
    next(err)
    return
  }

  req.clinicId = req.user.clinicId
  next()
}

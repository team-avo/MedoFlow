import type { Request } from 'express'
import type { ApiError } from '../types/errors'

export const assertClinicAccess = (req: Request, resourceClinicId: string | null): void => {
  if (!req.user) {
    const err = new Error('Authentication required') as ApiError
    err.statusCode = 401
    throw err
  }

  if (!resourceClinicId) {
    const err = new Error('Resource does not belong to any clinic') as ApiError
    err.statusCode = 403
    throw err
  }

  if (req.user.clinicId !== resourceClinicId) {
    const err = new Error('Access denied: resource belongs to another clinic') as ApiError
    err.statusCode = 403
    throw err
  }
}

/**
 * Phase 1: All users belong to exactly one clinic.
 * Sets req.clinicId from req.user.clinicId. No query/body clinicId.
 */
export const getClinicWhere = (req: Request): { clinicId: string } | Record<string, never> => {
  if (req.clinicId) {
    return { clinicId: req.clinicId }
  }
  return {}
}

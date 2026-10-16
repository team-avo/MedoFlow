import type { Request, Response, NextFunction } from 'express'
import type * as multer from 'multer'
import type { ApiError } from '../types/errors'
import { logError } from '../utils/errorLogger'
import { isAppointmentOverlapError, slotTakenError } from '../utils/bookingConflict'
import { AUDIO_SIZE_LIMIT_MB } from '../config/audioUpload'

export const errorHandler = (
  caught: ApiError | multer.MulterError,
  req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  // A write the B1.1 overlap constraint refused, from any code path (e.g. a
  // status change that re-activates a cancelled appointment): a clean 409,
  // never a 500 carrying the raw database message.
  const err = isAppointmentOverlapError(caught) ? slotTakenError() : caught
  const multerErr = err as multer.MulterError
  if (multerErr.code === 'LIMIT_FILE_SIZE') {
    // Only audio uploads still pass through multer (patient files go
    // straight to object storage, B3.1).
    return res.status(413).json({
      success: false,
      code: 'file_too_large',
      message: `Audio file too large. Maximum size is ${AUDIO_SIZE_LIMIT_MB}MB.`,
    })
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      code: 'file_too_large',
      message: 'Request body too large.',
    })
  }
  const statusCode = (err as ApiError).statusCode || 500
  // Unexpected (5xx) errors can carry query arguments or record contents in
  // their message (e.g. Prisma errors) — never echo them to the client in
  // production (B0.3.5). Deliberate 4xx messages are written for the client.
  const message =
    statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error'
  const stack = process.env.NODE_ENV === 'development' ? err.stack : undefined

  if (statusCode >= 500 || process.env.NODE_ENV !== 'test') {
    logError(err, {
      path: req.path,
      method: req.method,
      statusCode,
    })
  }

  const response: Record<string, unknown> = {
    success: false,
    message,
  }
  if (stack) response.stack = stack
  const apiErr = err as ApiError
  if (apiErr.code) {
    response.code = apiErr.code
  }
  if (apiErr.affectedAppointments && Array.isArray(apiErr.affectedAppointments)) {
    response.affectedAppointments = apiErr.affectedAppointments
  }

  return res.status(statusCode).json(response)
}

import type { Request, Response, NextFunction } from 'express'
import type * as multer from 'multer'
import type { ApiError } from '../types/errors'
import { logError } from '../utils/errorLogger'

export const errorHandler = (
  err: ApiError | multer.MulterError,
  req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  const multerErr = err as multer.MulterError
  if (multerErr.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Audio file too large. Maximum size is 50MB.',
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

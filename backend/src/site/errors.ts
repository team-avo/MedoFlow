import type { ApiError } from '../types/errors'

/** A deliberate 4xx with a machine-readable code (`site_*`). */
export function siteError(statusCode: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

export const notFound = (what: string): ApiError =>
  siteError(404, 'site_not_found', `${what} not found`)

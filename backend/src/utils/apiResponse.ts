import type { Response } from 'express'

export const successResponse = (
  res: Response,
  statusCode: number = 200,
  message: string = 'Success',
  data: unknown = {}
): Response => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  })
}

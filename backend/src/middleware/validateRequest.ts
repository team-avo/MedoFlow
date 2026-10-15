import type { Request, Response, NextFunction } from 'express'
import type { ZodTypeAny } from 'zod'
import { ZodError } from 'zod'
import type { ApiError } from '../types/errors'

export const validateRequest =
  (schema: { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny }) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body)
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params) as Request['params']
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query) as Request['query']
      }
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const err = new Error(error.issues.map((issue) => issue.message).join(', ')) as ApiError
        err.statusCode = 400
        next(err)
        return
      }

      next(error)
    }
  }

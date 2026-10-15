import type { Request, Response, NextFunction } from 'express'
import * as disciplineService from '../services/disciplineService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere } from '../middleware/clinicScope'
import type { ApiError } from '../types/errors'

export const create = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const discipline = await disciplineService.createDiscipline(
      req.body as disciplineService.CreateDisciplineData,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Discipline created', { discipline })
  }
)

export const list = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const where = getClinicWhere(req)
    const disciplines = await disciplineService.getDisciplines(where)
    successResponse(res, 200, 'Disciplines retrieved', { disciplines })
  }
)

export const getById = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const discipline = await disciplineService.getDisciplineById(id, where)
    if (!discipline) {
      const err = new Error('Discipline not found') as ApiError
      err.statusCode = 404
      throw err
    }
    successResponse(res, 200, 'Discipline retrieved', { discipline })
  }
)

export const update = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const existing = await disciplineService.getDisciplineById(id, where)
    if (!existing) {
      const err = new Error('Discipline not found') as ApiError
      err.statusCode = 404
      throw err
    }
    const discipline = await disciplineService.updateDiscipline(
      id,
      req.body as Partial<disciplineService.CreateDisciplineData>,
      where,
      req.user!.id
    )
    successResponse(res, 200, 'Discipline updated', { discipline })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const existing = await disciplineService.getDisciplineById(id, where)
    if (!existing) {
      const err = new Error('Discipline not found') as ApiError
      err.statusCode = 404
      throw err
    }
    await disciplineService.deleteDiscipline(id, where, req.user!.id)
    successResponse(res, 200, 'Discipline archived')
  }
)

import type { Request, Response, NextFunction } from 'express'
import type { Prisma } from '@prisma/client'
import * as formService from '../services/formService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { getClinicWhere } from '../middleware/clinicScope'
import type { ApiError } from '../types/errors'
import { assertAnswersMatchTemplate, type FormAnswers } from '../validation/clinicalRecordsSchemas'

export const createTemplate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const template = await formService.createTemplate(
      req.body as formService.CreateTemplateData,
      clinicId,
      req.user!.id
    )
    successResponse(res, 201, 'Form template created', { template })
  }
)

export const listTemplates = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const where = getClinicWhere(req)
    const templates = await formService.listTemplates(where)
    successResponse(res, 200, 'Templates retrieved', { templates })
  }
)

export const updateTemplate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    const template = await formService.updateTemplate(
      id,
      req.body as Partial<formService.CreateTemplateData>,
      where,
      req.user!.id
    )
    successResponse(res, 200, 'Template updated', { template })
  }
)

export const disableTemplate = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const id = req.params.id as string
    const where = getClinicWhere(req)
    if (Object.keys(where).length === 0) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }
    await formService.disableTemplate(id, where, req.user!.id)
    successResponse(res, 200, 'Template disabled')
  }
)

export const submitResponse = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    // Shape validated by formResponseSubmitSchema (B3.3).
    const { templateId, appointmentId, patientId, responses } = req.body as {
      templateId: string
      appointmentId?: string | null
      patientId?: string
      responses: FormAnswers
    }
    const resolvedPatientId = req.user!.id
    if (patientId && patientId !== resolvedPatientId) {
      const err = new Error('Patients can only submit for themselves') as ApiError
      err.statusCode = 403
      throw err
    }
    const template = await formService.getTemplateById(templateId, {})
    if (!template) {
      const err = new Error('Form template not found') as ApiError
      err.statusCode = 404
      throw err
    }
    // Answers must satisfy the template's own field definitions.
    assertAnswersMatchTemplate(template.fields, responses)
    const response = await formService.submitResponse({
      clinicId: template.clinicId,
      templateId,
      patientId: resolvedPatientId,
      appointmentId: appointmentId || undefined,
      responses: responses as Prisma.InputJsonValue,
      performedById: req.user!.id,
    })
    successResponse(res, 201, 'Response submitted', { response })
  }
)

export const getTemplatesForAppointment = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const appointmentId = req.params.appointmentId as string
    if (req.user!.role !== 'PATIENT') {
      const err = new Error('Only patients can fetch templates for appointment') as ApiError
      err.statusCode = 403
      throw err
    }
    const templates = await formService.getTemplatesForAppointment(appointmentId, req.user!.id)
    successResponse(res, 200, 'Templates retrieved', { templates })
  }
)

export const getResponsesByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    if (req.user!.role === 'PATIENT' && patientId !== req.user!.id) {
      const err = new Error('Patients can only access their own form responses') as ApiError
      err.statusCode = 403
      throw err
    }
    let clinicId = req.clinicId ?? (req.query.clinicId as string | undefined)
    if (req.user!.role === 'PATIENT' && !clinicId) {
      const membership = await formService.getPatientPrimaryClinic(patientId)
      clinicId = membership?.clinicId ?? undefined
    }
    if (!clinicId) {
      const err = new Error(
        'Clinic scope required. Provide clinicId or ensure patient has clinic membership.'
      ) as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    const isStaff =
      req.user!.role === 'SUPER_ADMIN' ||
      req.user!.role === 'FRONT_DESK' ||
      req.user!.role === 'PROVIDER'
    const responses = await formService.getResponsesByPatient(clinicId, patientId, isStaff)
    successResponse(res, 200, 'Responses retrieved', { responses })
  }
)

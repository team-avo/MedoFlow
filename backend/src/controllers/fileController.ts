import type { Request, Response, NextFunction } from 'express'
import * as fileService from '../services/fileService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import { assertClinicAccess } from '../middleware/clinicScope'
import { generateStoragePath } from '../config/multer'
import { logAudit, logRead } from '../services/auditService'
import { recordRecordAccess } from '../services/securityMonitorService'
import type { ApiError } from '../types/errors'
import fs from 'fs'

const parseTags = (val: unknown): unknown => {
  if (val === undefined || val === '') return undefined
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as unknown
    } catch {
      return undefined
    }
  }
  return val
}

export const upload = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const body = req.body as { patientId?: string; visitRecordId?: string; tags?: unknown }
    const patientId = body.patientId as string
    const visitRecordId = body.visitRecordId || undefined

    if (!clinicId || !patientId) {
      const err = new Error('clinicId and patientId are required') as ApiError
      err.statusCode = 400
      throw err
    }

    assertClinicAccess(req, clinicId)

    const file = req.file
    if (!file || !file.buffer) {
      const err = new Error('No file uploaded') as ApiError
      err.statusCode = 400
      throw err
    }

    const { dir, filename, relativePath } = generateStoragePath(
      clinicId,
      patientId,
      file.originalname
    )
    const destPath = `${dir}/${filename}`
    fs.writeFileSync(destPath, file.buffer)

    const result = await fileService.uploadFile({
      clinicId,
      patientId,
      visitRecordId,
      uploadedById: req.user!.id,
      originalName: file.originalname,
      storagePath: relativePath.replace(/\\/g, '/'),
      mimeType: file.mimetype,
      size: file.size,
      tags: parseTags(body.tags),
    })

    successResponse(res, 201, 'File uploaded', { id: result.id })
  }
)

export const listByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.params.patientId as string
    const clinicId = req.clinicId!
    const files = await fileService.getFilesByPatient(clinicId, patientId)
    successResponse(res, 200, 'Files retrieved', { files })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const fileId = req.params.id as string
    const clinicId = req.clinicId!
    await fileService.softDeleteFile(fileId, clinicId, req.user!.id)
    successResponse(res, 200, 'File deleted')
  }
)

export const listMyFiles = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.user!.id
    const clinicId =
      (req.query.clinicId as string) || (await fileService.getPatientPrimaryClinicId(patientId))
    if (!clinicId) {
      const err = new Error(
        'Clinic scope required. Provide clinicId or ensure you have clinic membership.'
      ) as ApiError
      err.statusCode = 400
      err.code = 'validation_error'
      throw err
    }
    await fileService.assertPatientCanAccessClinicFiles(patientId, clinicId)
    const files = await fileService.getFilesByPatient(clinicId, patientId)
    successResponse(res, 200, 'Files retrieved', { files })
  }
)

export const downloadMyFile = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const fileId = req.params.id as string
    const patientId = req.user!.id
    const clinicId =
      (req.query.clinicId as string) || (await fileService.getPatientPrimaryClinicId(patientId))
    if (!clinicId) {
      const err = new Error('Clinic scope required') as ApiError
      err.statusCode = 400
      throw err
    }
    const result = await fileService.getFileForPatientDownload(
      fileId,
      patientId,
      clinicId,
      req.user!.id
    )
    if (!result) {
      const err = new Error('File not found') as ApiError
      err.statusCode = 404
      throw err
    }
    await logRead(req, { entityType: 'PatientFile', entityId: fileId, clinicId })
    const { filePath, originalName, mimeType } = result
    res.download(filePath, originalName, {
      headers: mimeType ? { 'Content-Type': mimeType } : undefined,
    })
  }
)

export const download = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const fileId = req.params.id as string
    const clinicId = req.clinicId!
    const file = await fileService.getFileById(fileId, clinicId)
    if (!file) {
      const err = new Error('File not found') as ApiError
      err.statusCode = 404
      throw err
    }

    const belongs = await fileService.validatePatientBelongsToClinic(file.patientId, clinicId)
    if (!belongs) {
      const err = new Error('Access denied') as ApiError
      err.statusCode = 403
      throw err
    }

    const downloadInfo = await fileService.getFileForDownload(fileId, clinicId)
    if (!downloadInfo) {
      const err = new Error('File not found') as ApiError
      err.statusCode = 404
      throw err
    }

    await logAudit({
      clinicId,
      entityType: 'PatientFile',
      entityId: fileId,
      action: 'FILE_DOWNLOADED',
      newValue: { originalName: file.originalName },
      performedById: req.user!.id,
    })
    recordRecordAccess({
      userId: req.user!.id,
      clinicId,
      entityType: 'PatientFile',
      entityId: fileId,
    })

    res.download(downloadInfo.filePath, downloadInfo.originalName, {
      headers: downloadInfo.mimeType ? { 'Content-Type': downloadInfo.mimeType } : undefined,
    })
  }
)

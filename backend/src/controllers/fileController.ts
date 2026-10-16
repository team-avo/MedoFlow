import type { Request, Response, NextFunction } from 'express'
import * as fileService from '../services/fileService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import { LocalFileStorage, getPatientFileStorage } from '../services/fileStorage'
import {
  verifyBlobToken,
  resolveLocalPath,
  BlobTokenError,
} from '../services/fileStorage/localDriver'
import type { createUploadIntentSchema } from '../validation/fileSchemas'
import type { z } from 'zod'
import fs from 'fs'

/** Public origin of this API as the caller reached it (local driver URLs). */
const baseUrlOf = (req: Request): string => `${req.protocol}://${req.get('host')}`

const patientClinicId = async (req: Request): Promise<string> => {
  const patientId = req.user!.id
  const clinicId =
    (req.query.clinicId as string | undefined) ||
    (await fileService.getPatientPrimaryClinicId(patientId))
  if (!clinicId) {
    const err = new Error(
      'Clinic scope required. Provide clinicId or ensure you have clinic membership.'
    ) as ApiError
    err.statusCode = 400
    err.code = 'validation_error'
    throw err
  }
  return clinicId
}

/** POST /files/uploads — step 1: presigned upload URL. */
export const createUpload = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const body = req.body as z.infer<typeof createUploadIntentSchema>
    const intent = await fileService.createUploadIntent({
      clinicId: req.clinicId!,
      patientId: body.patientId,
      visitRecordId: body.visitRecordId ?? null,
      uploadedById: req.user!.id,
      fileName: body.fileName,
      mimeType: body.mimeType,
      size: body.size,
      tags: body.tags,
      baseUrl: baseUrlOf(req),
    })
    successResponse(res, 201, 'Upload URL issued', intent)
  }
)

/** POST /files/:id/complete — step 2: verify the stored object. */
export const completeUpload = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const result = await fileService.completeUpload(req.params.id as string, req.clinicId!, req)
    successResponse(res, 200, 'File uploaded', result)
  }
)

export const listByPatient = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const files = await fileService.getFilesByPatient(req.clinicId!, req.params.patientId as string)
    successResponse(res, 200, 'Files retrieved', { files })
  }
)

export const remove = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    await fileService.softDeleteFile(req.params.id as string, req.clinicId!, req.user!.id, req)
    successResponse(res, 200, 'File deleted')
  }
)

export const listMyFiles = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const patientId = req.user!.id
    const clinicId = await patientClinicId(req)
    await fileService.assertPatientCanAccessClinicFiles(patientId, clinicId)
    const files = await fileService.getFilesByPatient(clinicId, patientId)
    successResponse(res, 200, 'Files retrieved', { files })
  }
)

/** GET /files/:id/download-url — staff; time-limited presigned GET. */
export const downloadUrl = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const grant = await fileService.getStaffDownloadUrl(
      req.params.id as string,
      req.clinicId!,
      req,
      baseUrlOf(req)
    )
    successResponse(res, 200, 'Download URL issued', grant)
  }
)

/** GET /files/patient/me/:id/download-url — patient; own files only. */
export const myDownloadUrl = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const grant = await fileService.getPatientDownloadUrl(
      req.params.id as string,
      req.user!.id,
      await patientClinicId(req),
      req,
      baseUrlOf(req)
    )
    successResponse(res, 200, 'Download URL issued', grant)
  }
)

// ── Local-disk presigned URLs (development / CI only) ─────────────────────
// These play the role of the bucket: the signed token is the only
// authorisation, exactly like an S3 presigned URL. Production never serves
// them (boot refuses local storage; the routes 404 regardless).

const localBlobStorage = (): LocalFileStorage => {
  const storage = getPatientFileStorage()
  if (process.env.NODE_ENV === 'production' || !(storage instanceof LocalFileStorage)) {
    const err = new Error('Not Found') as ApiError
    err.statusCode = 404
    throw err
  }
  return storage
}

const baseType = (ct: string | undefined): string => (ct ?? '').split(';')[0]!.trim().toLowerCase()

export const putBlob = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const storage = localBlobStorage()
    const grant = verifyBlobToken(req.params.token as string, 'put')
    if (baseType(req.get('content-type')) !== grant.ct) throw new BlobTokenError('content-type')
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (body.length !== grant.len) throw new BlobTokenError('content-length')
    storage.write(grant.k, body)
    res.status(200).end()
  } catch (err) {
    next(err)
  }
}

export const getBlob = (req: Request, res: Response, next: NextFunction): void => {
  try {
    localBlobStorage()
    const grant = verifyBlobToken(req.params.token as string, 'get')
    const filePath = resolveLocalPath(grant.k)
    if (!fs.existsSync(filePath)) {
      const err = new Error('Not Found') as ApiError
      err.statusCode = 404
      throw err
    }
    res.set({
      'Content-Type': grant.ct,
      'Content-Disposition': 'attachment',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    fs.createReadStream(filePath).on('error', next).pipe(res)
  } catch (err) {
    next(err)
  }
}

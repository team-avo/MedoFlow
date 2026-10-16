import express, { Router } from 'express'
import * as fileController from '../controllers/fileController'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { validateRequest } from '../middleware/validateRequest'
import {
  createUploadIntentSchema,
  fileIdParamsSchema,
  patientIdParamsSchema,
  patientClinicQuerySchema,
} from '../validation/fileSchemas'
import { FILE_SIZE_LIMIT_BYTES } from '../config/fileConstants'
import { Role } from '@prisma/client'

const router = Router()

/**
 * B3.1: file bytes never pass through an authenticated API route. Clients
 * request a presigned URL, PUT/GET the object directly, and the API only
 * issues and verifies. The two /blob routes below stand in for the bucket
 * when object storage is not configured (development / CI).
 */
router.put(
  '/blob/:token',
  express.raw({ type: () => true, limit: FILE_SIZE_LIMIT_BYTES }),
  fileController.putBlob
)
router.get('/blob/:token', fileController.getBlob)

router.use(protect)

const STAFF = [Role.PROVIDER, Role.FRONT_DESK, Role.SUPER_ADMIN] as const

router.post(
  '/uploads',
  requireClinic,
  authorize(...STAFF),
  validateRequest({ body: createUploadIntentSchema }),
  fileController.createUpload
)

router.post(
  '/:id/complete',
  requireClinic,
  authorize(...STAFF),
  validateRequest({ params: fileIdParamsSchema }),
  fileController.completeUpload
)

router.get(
  '/patient/me',
  authorize(Role.PATIENT),
  validateRequest({ query: patientClinicQuerySchema }),
  fileController.listMyFiles
)

router.get(
  '/patient/me/:id/download-url',
  authorize(Role.PATIENT),
  validateRequest({ params: fileIdParamsSchema, query: patientClinicQuerySchema }),
  fileController.myDownloadUrl
)

router.get(
  '/patient/:patientId',
  requireClinic,
  authorize(...STAFF),
  validateRequest({ params: patientIdParamsSchema }),
  fileController.listByPatient
)

router.get(
  '/:id/download-url',
  requireClinic,
  authorize(...STAFF),
  validateRequest({ params: fileIdParamsSchema }),
  fileController.downloadUrl
)

router.delete(
  '/:id',
  requireClinic,
  authorize(...STAFF),
  validateRequest({ params: fileIdParamsSchema }),
  fileController.remove
)

export default router

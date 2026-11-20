/**
 * CTO-40: product catalog imports (a connected store, or a CSV / .xlsx file):
 * dry-run preview, edits, apply, retry. Owner and admins, or staff holding
 * products.manage.
 */
import { Router } from 'express'
import type { z } from 'zod'
import multer from 'multer'
import { authorizeRolesOrPermission, protect, requireClinicScope } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import * as imports from '../services/catalogImport/service'
import { FILE_PRESETS, FILE_PRESET_LABELS, MAPPED_FIELDS } from '../services/catalogImport/presets'
import { actorOf } from './storeConnections'
import {
  editImportSchema,
  fileImportFieldsSchema,
  rowsQuerySchema,
  startImportSchema,
} from '../validation/catalogImportSchemas'

const router = Router()

// The 5 MB product-file limit is checked by the service (with a clear
// message); this is only the hard stop.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})

router.use(protect, requireClinicScope, authorizeRolesOrPermission([], 'products.manage'))

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Imports', {
      imports: await imports.listImports(req.user!.clinicId!),
      presets: FILE_PRESETS.map((id) => ({ id, label: FILE_PRESET_LABELS[id] })),
      fields: MAPPED_FIELDS,
    })
  })
)

router.post(
  '/',
  validateRequest({ body: startImportSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof startImportSchema>
    const imp = await imports.startConnectionImport(actorOf(req), body.connectionId, body.options)
    successResponse(res, 202, 'Reading the store', { import: imp })
  })
)

router.post(
  '/file',
  upload.single('file'),
  validateRequest({ body: fileImportFieldsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw Object.assign(new Error('Choose a CSV or Excel file'), {
        statusCode: 400,
        code: 'no_file',
      })
    }
    const body = req.body as z.infer<typeof fileImportFieldsSchema>
    const imp = await imports.createFileImport(actorOf(req), {
      buffer: req.file.buffer,
      preset: body.preset,
      mapping: body.mapping,
      options: body.options,
    })
    successResponse(res, 201, 'File read', { import: imp })
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Import', {
      import: await imports.getImport(req.user!.clinicId!, req.params.id as string),
    })
  })
)

router.get(
  '/:id/rows',
  validateRequest({ query: rowsQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number; pageSize: number; filter: imports.RowFilter }
    successResponse(
      res,
      200,
      'Rows',
      await imports.listRows(req.user!.clinicId!, req.params.id as string, q)
    )
  })
)

router.patch(
  '/:id',
  validateRequest({ body: editImportSchema }),
  asyncHandler(async (req, res) => {
    const imp = await imports.editImport(
      actorOf(req),
      req.params.id as string,
      req.body as z.infer<typeof editImportSchema>
    )
    successResponse(res, 200, 'Import updated', { import: imp })
  })
)

router.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const imp = await imports.applyImport(actorOf(req), req.params.id as string)
    successResponse(res, 202, 'Importing', { import: imp })
  })
)

router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const imp = await imports.retryImport(actorOf(req), req.params.id as string)
    successResponse(res, 202, 'Retrying', { import: imp })
  })
)

export default router

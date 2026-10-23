/** /api/v1/site/assets — website image library (presigned uploads). */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as assets from '../../services/assetService'
import { editorGuard } from './guards'

const router = Router()
router.use(...editorGuard)

const idParam = z.object({ id: entityId })

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Images', { items: await assets.listAssets(actorFrom(req).clinicId) })
  })
)

router.post(
  '/uploads',
  validateRequest({
    body: z.object({
      mimeType: z.string().max(60),
      size: z.number().int().positive(),
      alt: z.string().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const intent = await assets.createUploadIntent(
      actorFrom(req),
      req.body as { mimeType: string; size: number; alt?: string },
      `${req.protocol}://${req.get('host')}`
    )
    successResponse(res, 201, 'Upload ready', intent)
  })
)

router.post(
  '/:id/complete',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Image uploaded',
      await assets.completeUpload(actorFrom(req), String(req.params.id))
    )
  })
)

router.patch(
  '/:id',
  validateRequest({ params: idParam, body: z.object({ alt: z.string().max(200) }) }),
  asyncHandler(async (req, res) => {
    const a = await assets.updateAssetAlt(
      actorFrom(req),
      String(req.params.id),
      (req.body as { alt: string }).alt
    )
    successResponse(res, 200, 'Image updated', a)
  })
)

router.delete(
  '/:id',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    await assets.deleteAsset(actorFrom(req), String(req.params.id))
    successResponse(res, 200, 'Image deleted')
  })
)

export default router

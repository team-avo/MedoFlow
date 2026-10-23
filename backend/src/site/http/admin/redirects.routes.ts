/** /api/v1/site/redirects — URL redirects (automatic + manual, CSV import). */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as redirects from '../../services/redirectService'
import { editorGuard } from './guards'

const router = Router()
router.use(...editorGuard)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Redirects', {
      items: await redirects.listRedirects(actorFrom(req).clinicId),
    })
  })
)

router.post(
  '/',
  validateRequest({
    body: z.object({
      fromPath: z.string().min(1).max(300),
      toPath: z.string().min(1).max(2000),
      code: z.union([z.literal(301), z.literal(302)]).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const row = await redirects.createRedirect(
      actorFrom(req),
      req.body as { fromPath: string; toPath: string; code?: 301 | 302 }
    )
    successResponse(res, 201, 'Redirect created', row)
  })
)

router.post(
  '/import',
  validateRequest({ body: z.object({ csv: z.string().max(100_000) }) }),
  asyncHandler(async (req, res) => {
    const results = await redirects.importRedirects(
      actorFrom(req),
      (req.body as { csv: string }).csv
    )
    successResponse(res, 200, 'Import finished', { results })
  })
)

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: entityId }) }),
  asyncHandler(async (req, res) => {
    await redirects.deleteRedirect(actorFrom(req), String(req.params.id))
    successResponse(res, 200, 'Redirect deleted')
  })
)

export default router

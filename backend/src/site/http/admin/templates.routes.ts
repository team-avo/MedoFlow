/** /api/v1/site/templates — the template gallery and installs. */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import * as siteService from '../../services/siteService'
import { editorGuard } from './guards'

const router = Router()
router.use(...editorGuard)

const keyParam = z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/) })

router.get('/', (_req, res) => {
  successResponse(res, 200, 'Templates', { items: siteService.listTemplates() })
})

router.get('/:key', validateRequest({ params: keyParam }), (req, res) => {
  successResponse(res, 200, 'Template', siteService.getTemplateDetail(String(req.params.key)))
})

router.post(
  '/:key/install',
  validateRequest({
    params: keyParam,
    body: z.object({ mode: z.enum(['replace', 'styles-only']) }),
  }),
  asyncHandler(async (req, res) => {
    const { mode } = req.body as { mode: 'replace' | 'styles-only' }
    const site = await siteService.installTemplate(actorFrom(req), String(req.params.key), mode)
    successResponse(res, 200, 'Template installed', site)
  })
)

export default router

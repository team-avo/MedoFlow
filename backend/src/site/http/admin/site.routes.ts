/** /api/v1/site — the site as a whole: settings, publish, preview links, AI copy. */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as siteService from '../../services/siteService'
import { personaliseHomeCopy } from '../../services/aiCopyService'
import { setEntitySlug } from '../../services/slugService'
import { editorData } from '../../services/renderService'
import { editorGuard } from './guards'

const router = Router()
router.use(...editorGuard)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Site', await siteService.getSiteForAdmin(actorFrom(req).clinicId))
  })
)

router.get(
  '/editor-data',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Editor data', await editorData(actorFrom(req).clinicId))
  })
)

router.put(
  '/settings',
  validateRequest({ body: z.object({ settings: z.unknown() }) }),
  asyncHandler(async (req, res) => {
    const body = req.body as { settings: unknown }
    const settings = await siteService.updateSettings(actorFrom(req), body.settings)
    successResponse(res, 200, 'Settings saved', { settings })
  })
)

router.post(
  '/publish',
  validateRequest({
    body: z.object({ pageIds: z.union([z.literal('all'), z.array(entityId).max(200)]).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as { pageIds?: string[] | 'all' }
    successResponse(res, 200, 'Site published', await siteService.publishSite(actorFrom(req), body))
  })
)

router.post(
  '/preview-link',
  validateRequest({ body: z.object({ pageId: entityId }) }),
  asyncHandler(async (req, res) => {
    const body = req.body as { pageId: string }
    successResponse(
      res,
      200,
      'Preview link',
      await siteService.issuePreviewLink(actorFrom(req), body.pageId)
    )
  })
)

router.post(
  '/ai/home-copy',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Home copy', await personaliseHomeCopy(actorFrom(req)))
  })
)

router.put(
  '/slugs/:entity/:id',
  validateRequest({
    params: z.object({ entity: z.enum(['service', 'provider', 'product']), id: entityId }),
    body: z.object({ slug: z.string().min(1).max(62) }),
  }),
  asyncHandler(async (req, res) => {
    const { entity, id } = req.params as { entity: 'service' | 'provider' | 'product'; id: string }
    const result = await setEntitySlug(
      actorFrom(req),
      entity,
      id,
      (req.body as { slug: string }).slug
    )
    successResponse(res, 200, 'URL updated', result)
  })
)

export default router

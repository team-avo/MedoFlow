/** /api/v1/site/pages — page CRUD, publish, revisions. */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as pages from '../../services/pageService'
import { editorGuard } from './guards'

const router = Router()
router.use(...editorGuard)

const idParam = z.object({ id: entityId })
const KINDS = ['HOME', 'STANDARD', 'SERVICES', 'TEAM', 'CONTACT', 'LEGAL'] as const

const createBody = z.object({
  kind: z.enum(KINDS).optional(),
  slug: z.string().max(62).optional(),
  title: z.string().trim().min(1).max(200),
  sections: z.array(z.unknown()).max(40).optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  showInNav: z.boolean().optional(),
})

const updateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().max(62).optional(),
  sections: z.array(z.unknown()).max(40).optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
  ogImageAssetId: entityId.nullable().optional(),
  showInNav: z.boolean().optional(),
  navOrder: z.number().int().min(0).max(100000).optional(),
  noindex: z.boolean().optional(),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Pages', { items: await pages.listPages(actorFrom(req).clinicId) })
  })
)

router.post(
  '/',
  validateRequest({ body: createBody }),
  asyncHandler(async (req, res) => {
    const page = await pages.createPage(actorFrom(req), req.body as pages.CreatePageInput)
    successResponse(res, 201, 'Page created', page)
  })
)

router.get(
  '/:id',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    const page = await pages.getPageForEditor(actorFrom(req).clinicId, String(req.params.id))
    successResponse(res, 200, 'Page', page)
  })
)

router.put(
  '/:id',
  validateRequest({ params: idParam, body: updateBody }),
  asyncHandler(async (req, res) => {
    const page = await pages.updatePageDraft(
      actorFrom(req),
      String(req.params.id),
      req.body as pages.UpdatePageInput
    )
    successResponse(res, 200, 'Draft saved', page)
  })
)

router.post(
  '/:id/publish',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Published',
      await pages.publishPage(actorFrom(req), String(req.params.id))
    )
  })
)

router.post(
  '/:id/unpublish',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Unpublished',
      await pages.unpublishPage(actorFrom(req), String(req.params.id))
    )
  })
)

router.post(
  '/:id/duplicate',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      201,
      'Duplicated',
      await pages.duplicatePage(actorFrom(req), String(req.params.id))
    )
  })
)

router.delete(
  '/:id',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    await pages.deletePage(actorFrom(req), String(req.params.id))
    successResponse(res, 200, 'Deleted')
  })
)

router.get(
  '/:id/revisions',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    const items = await pages.listRevisions(actorFrom(req).clinicId, String(req.params.id))
    successResponse(res, 200, 'Revisions', { items })
  })
)

router.post(
  '/:id/revisions/:version/restore',
  validateRequest({
    params: z.object({ id: entityId, version: z.coerce.number().int().min(1) }),
  }),
  asyncHandler(async (req, res) => {
    const { id, version } = req.params as unknown as { id: string; version: number }
    successResponse(
      res,
      200,
      'Restored to draft',
      await pages.restoreRevision(actorFrom(req), id, Number(version))
    )
  })
)

export default router

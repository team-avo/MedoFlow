import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import { validateRequest } from '../middleware/validateRequest'
import { Role } from '@prisma/client'
import * as sitePageService from '../services/sitePageService'
import type { ApiError } from '../types/errors'

const router = Router()

router.use(protect)
router.use(requireClinic)
router.use(authorize(Role.SUPER_ADMIN))

const sectionSchema = z.object({
  type: z.string().min(1).max(60),
  settings: z.record(z.string(), z.unknown()).optional(),
  blocks: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(40)
    .optional(),
})

const createSchema = {
  body: z.object({
    slug: z.string().min(1).max(62),
    title: z.string().min(1).max(200),
    sections: z.array(sectionSchema).max(50).optional(),
    seoTitle: z.string().max(200).nullable().optional(),
    seoDescription: z.string().max(500).nullable().optional(),
  }),
}

const updateSchema = {
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    sections: z.array(sectionSchema).max(50).optional(),
    seoTitle: z.string().max(200).nullable().optional(),
    seoDescription: z.string().max(500).nullable().optional(),
  }),
}

function clinicId(req: { user?: { clinicId?: string | null } }): string {
  const id = req.user?.clinicId
  if (!id) {
    const err = new Error('Clinic context required') as ApiError
    err.statusCode = 403
    throw err
  }
  return id
}

// POST /ai-bootstrap  — AI-generate section content and save as draft
router.post(
  '/ai-bootstrap',
  validateRequest({
    body: z.object({
      name: z.string().min(1).max(200),
      logoUrl: z.string().optional().nullable(),
      themeColor: z.string().max(20).optional().nullable(),
      sectionTypes: z.array(z.string().min(1).max(60)).min(1).max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await sitePageService.aiBootstrapPage(
      clinicId(req),
      req.body as Parameters<typeof sitePageService.aiBootstrapPage>[1]
    )
    successResponse(res, 200, 'Bootstrap complete', result)
  })
)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await sitePageService.listPages(clinicId(req))
    successResponse(res, 200, 'Pages', { items })
  })
)

router.post(
  '/',
  validateRequest(createSchema),
  asyncHandler(async (req, res) => {
    const page = await sitePageService.createPage(
      clinicId(req),
      req.body as Parameters<typeof sitePageService.createPage>[1]
    )
    successResponse(res, 201, 'Page created', page)
  })
)

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const page = await sitePageService.getPage(clinicId(req), String(req.params['id']))
    successResponse(res, 200, 'Page', page)
  })
)

router.put(
  '/:id',
  validateRequest(updateSchema),
  asyncHandler(async (req, res) => {
    const page = await sitePageService.updateDraft(
      clinicId(req),
      String(req.params['id']),
      req.body as Parameters<typeof sitePageService.updateDraft>[2]
    )
    successResponse(res, 200, 'Draft saved', page)
  })
)

router.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const page = await sitePageService.publish(clinicId(req), String(req.params['id']))
    successResponse(res, 200, 'Published', page)
  })
)

router.post(
  '/:id/unpublish',
  asyncHandler(async (req, res) => {
    const page = await sitePageService.unpublish(clinicId(req), String(req.params['id']))
    successResponse(res, 200, 'Unpublished', page)
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await sitePageService.deletePage(clinicId(req), String(req.params['id']))
    successResponse(res, 200, 'Deleted')
  })
)

export default router

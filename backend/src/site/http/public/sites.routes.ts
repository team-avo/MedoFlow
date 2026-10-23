/**
 * /api/v1/public/sites — everything a clinic website needs at request time.
 * Mounted inside the public router (tenant guard bypassed): every handler
 * scopes by the clinic it resolved from the host or slug.
 */
import crypto from 'crypto'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { siteLeadRateLimit, siteRenderRateLimit } from '../../../middleware/rateLimit'
import { resolveHost } from '../../services/hostService'
import * as renderService from '../../services/renderService'
import { templatePreview } from '../../services/templatePreview'
import { createLead } from '../../services/leadService'
import { readLocalAsset } from '../../services/assetService'
import { siteError } from '../../errors'
import prisma from '../../../config/prisma'

const router = Router()

const hostOrClinic = z
  .object({
    host: z.string().max(260).optional(),
    clinic: z.string().max(80).optional(),
  })
  .refine((v) => v.host || v.clinic, 'host or clinic is required')

function sendCached(res: Response, status: number, body: unknown, maxAge: number) {
  const json = JSON.stringify(body)
  const etag = `W/"${crypto.createHash('sha1').update(json).digest('base64url')}"`
  res.set('ETag', etag)
  res.set(
    'Cache-Control',
    maxAge > 0 ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=300` : 'no-store'
  )
  if (res.req.get('if-none-match') === etag && maxAge > 0) {
    res.status(304).end()
    return
  }
  res.status(status).type('application/json').send(json)
}

router.get(
  '/resolve',
  siteRenderRateLimit,
  validateRequest({ query: z.object({ host: z.string().min(1).max(260) }) }),
  asyncHandler(async (req, res) => {
    const r = await resolveHost(req.query.host as string)
    const data =
      r.kind === 'site'
        ? { kind: r.kind, clinicSlug: r.clinicSlug, origin: r.origin }
        : r.kind === 'alias'
          ? { kind: r.kind, origin: r.origin }
          : { kind: r.kind }
    sendCached(res, 200, { success: true, message: 'Host', data }, 60)
  })
)

router.get(
  '/render',
  siteRenderRateLimit,
  validateRequest({
    query: z.intersection(
      hostOrClinic,
      z.object({ path: z.string().max(600).default('/'), preview: z.string().max(400).optional() })
    ),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as { host?: string; clinic?: string; path: string; preview?: string }
    const result = await renderService.render({
      host: q.host,
      clinic: q.clinic,
      path: q.path || '/',
      previewToken: q.preview,
    })
    if (result.type === 'unknown-site') {
      sendCached(res, 404, { success: false, code: 'site_unknown', message: 'No site here' }, 30)
      return
    }
    if (result.type === 'redirect') {
      sendCached(res, 200, { success: true, message: 'Redirect', data: { redirect: result } }, 60)
      return
    }
    const preview = result.payload.preview
    sendCached(
      res,
      result.status,
      { success: result.status === 200, message: 'Site page', data: result.payload },
      preview ? 0 : 60
    )
  })
)

router.get(
  '/sitemap',
  siteRenderRateLimit,
  validateRequest({ query: hostOrClinic }),
  asyncHandler(async (req, res) => {
    const q = req.query as { host?: string; clinic?: string }
    const map = await renderService.sitemap(q)
    if (!map) throw siteError(404, 'site_unknown', 'No site here')
    sendCached(res, 200, { success: true, message: 'Sitemap', data: map }, 300)
  })
)

router.get(
  '/templates/:key/preview',
  siteRenderRateLimit,
  validateRequest({
    params: z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
    query: z.object({
      page: z
        .string()
        .regex(/^[a-z0-9-]{1,62}$/)
        .optional(),
    }),
  }),
  (req, res) => {
    const payload = templatePreview(String(req.params.key), req.query.page as string | undefined)
    if (!payload) throw siteError(404, 'site_not_found', 'Template not found')
    sendCached(res, 200, { success: true, message: 'Template preview', data: payload }, 300)
  }
)

router.post(
  '/leads',
  siteLeadRateLimit,
  validateRequest({
    body: z.object({
      host: z.string().max(260).optional(),
      clinic: z.string().max(80).optional(),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(200),
      phone: z.string().trim().max(40).optional(),
      message: z.string().trim().min(1).max(4000),
      sourcePath: z.string().max(300).optional(),
      website: z.string().max(200).optional(),
      startedAt: z.number().int().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const body = req.body as Parameters<typeof createLead>[1] & { host?: string; clinic?: string }
    let clinicId: string | null = null
    if (body.host) {
      const r = await resolveHost(body.host)
      if (r.kind === 'site' || r.kind === 'alias') clinicId = r.clinicId
    }
    if (!clinicId && body.clinic) {
      const c = await prisma.clinic.findFirst({
        where: { isActive: true, OR: [{ slug: body.clinic }, { id: body.clinic }] },
        select: { id: true },
      })
      clinicId = c?.id ?? null
    }
    if (!clinicId) throw siteError(404, 'site_unknown', 'No site here')
    await createLead(clinicId, body)
    res.set('Cache-Control', 'no-store')
    successResponse(res, 201, 'Message sent', { accepted: true })
  })
)

/** Local-driver image serving (dev/CI). Production images come from the CDN. */
router.get(
  '/assets/:clinicId/:file',
  asyncHandler(async (req, res) => {
    const hit = await readLocalAsset(String(req.params.clinicId), String(req.params.file))
    if (!hit) throw siteError(404, 'site_not_found', 'Image not found')
    res.set({
      'Content-Type': hit.asset.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    res.send(hit.body)
  })
)

export default router

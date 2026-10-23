/** /api/v1/site/domains — subdomain and custom domains (owners only). */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as domains from '../../services/domainService'
import { ownerGuard } from './guards'

const router = Router()
router.use(...ownerGuard)

const idParam = z.object({ id: entityId })

router.get(
  '/',
  asyncHandler(async (req, res) => {
    successResponse(res, 200, 'Domains', await domains.listDomains(actorFrom(req).clinicId))
  })
)

router.put(
  '/subdomain',
  validateRequest({ body: z.object({ label: z.string().min(3).max(63) }) }),
  asyncHandler(async (req, res) => {
    const out = await domains.changeSubdomain(actorFrom(req), (req.body as { label: string }).label)
    successResponse(res, 200, 'Subdomain updated', out)
  })
)

router.post(
  '/',
  validateRequest({ body: z.object({ hostname: z.string().min(3).max(253) }) }),
  asyncHandler(async (req, res) => {
    const d = await domains.addCustomDomain(
      actorFrom(req),
      (req.body as { hostname: string }).hostname
    )
    successResponse(res, 201, 'Domain added — create the DNS records below, then verify', d)
  })
)

router.post(
  '/:id/verify',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Domain checked',
      await domains.verifyDomain(actorFrom(req), String(req.params.id))
    )
  })
)

router.post(
  '/:id/primary',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Primary domain set',
      await domains.setPrimaryDomain(actorFrom(req), String(req.params.id))
    )
  })
)

router.delete(
  '/:id',
  validateRequest({ params: idParam }),
  asyncHandler(async (req, res) => {
    successResponse(
      res,
      200,
      'Domain removed',
      await domains.removeDomain(actorFrom(req), String(req.params.id))
    )
  })
)

export default router

/**
 * CTO-40: connecting outside stores (Shopify, Square, WooCommerce, Wix) for
 * catalog import. Owner and admins, or staff holding products.manage.
 */
import { Router, type Request } from 'express'
import type { z } from 'zod'
import {
  authorizeRolesOrPermission,
  protect,
  requireClinicScope,
  withPublicScope,
} from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { publicApiRateLimit } from '../middleware/rateLimit'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { requestMeta } from '../services/auditService'
import * as connections from '../services/storeConnections'
import type { StoreProvider } from '../services/catalogImport/types'
import {
  completeConnectionSchema,
  providerParamSchema,
  startConnectionSchema,
  wixKeySchema,
  wooCallbackSchema,
  wooKeySchema,
} from '../validation/catalogImportSchemas'

const router = Router()

export const actorOf = (req: Request): connections.Actor => ({
  clinicId: req.user!.clinicId!,
  userId: req.user!.id,
  ...requestMeta(req),
})

const providerOf = (req: Request) => (req.params.provider as string).toUpperCase() as StoreProvider

// WooCommerce posts the new read-only key here, server to server, with the
// signed state as user_id. No session; the state says which clinic.
router.post(
  '/woocommerce/callback',
  publicApiRateLimit,
  withPublicScope('woocommerce_key_callback'),
  validateRequest({ body: wooCallbackSchema }),
  asyncHandler(async (req, res) => {
    await connections.wooCallback(req.body as Record<string, unknown>)
    successResponse(res, 200, 'Key received', {})
  })
)

router.use(protect, requireClinicScope, authorizeRolesOrPermission([], 'products.manage'))

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clinicId = req.user!.clinicId!
    successResponse(res, 200, 'Store connections', {
      providers: connections.providerCatalog(),
      connections: await connections.listConnections(clinicId),
    })
  })
)

router.post(
  '/woocommerce/key',
  validateRequest({ body: wooKeySchema }),
  asyncHandler(async (req, res) => {
    const connection = await connections.connectWooKey(
      actorOf(req),
      req.body as z.infer<typeof wooKeySchema>
    )
    successResponse(res, 201, 'WooCommerce connected', { connection })
  })
)

router.post(
  '/wix/key',
  validateRequest({ body: wixKeySchema }),
  asyncHandler(async (req, res) => {
    const connection = await connections.connectWix(
      actorOf(req),
      req.body as z.infer<typeof wixKeySchema>
    )
    successResponse(res, 201, 'Wix connected', { connection })
  })
)

router.post(
  '/:provider/start',
  validateRequest({ params: providerParamSchema, body: startConnectionSchema }),
  (req, res) => {
    const { url } = connections.startConnection(
      actorOf(req),
      providerOf(req),
      req.body as z.infer<typeof startConnectionSchema>
    )
    successResponse(res, 200, 'Continue at the store', { url })
  }
)

router.post(
  '/:provider/complete',
  validateRequest({ params: providerParamSchema, body: completeConnectionSchema }),
  asyncHandler(async (req, res) => {
    const connection = await connections.completeOAuth(
      actorOf(req),
      providerOf(req),
      (req.body as z.infer<typeof completeConnectionSchema>).query
    )
    successResponse(res, 201, 'Store connected', { connection })
  })
)

router.post(
  '/:id/disconnect',
  asyncHandler(async (req, res) => {
    const result = await connections.disconnect(actorOf(req), req.params.id as string)
    successResponse(res, 200, 'Store disconnected', result)
  })
)

export default router

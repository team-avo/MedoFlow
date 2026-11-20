import { Router } from 'express'
import express from 'express'
import * as webhookController from '../controllers/webhookController'
import { withPublicScope } from '../middleware/auth'
import { publicApiRateLimit } from '../middleware/rateLimit'
import { verifyShopifyWebhook } from '../services/storeConnections/shopify'
import { handleShopifyWebhook } from '../services/storeConnections'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()

// Webhooks arrive outside any user session. They embed the tenant/clinic
// context in their payload metadata; handlers dispatch to the correct
// clinic scope after signature verification.
router.use(withPublicScope('stripe_webhook'))

// Stripe requires the raw body to construct the event
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  asyncHandler(webhookController.handleStripeWebhook)
)

// CTO-40: Shopify app webhooks (app/uninstalled and the mandatory privacy
// topics). The HMAC over the raw body is checked before anything is read.
router.post(
  '/shopify',
  publicApiRateLimit,
  express.raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!verifyShopifyWebhook(body, req.get('x-shopify-hmac-sha256'))) {
      res.status(401).json({ success: false, message: 'Invalid signature' })
      return
    }
    await handleShopifyWebhook(
      req.get('x-shopify-topic') ?? '',
      req.get('x-shopify-shop-domain') ?? ''
    )
    res.status(200).json({ success: true })
  })
)

export default router

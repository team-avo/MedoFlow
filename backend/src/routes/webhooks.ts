import { Router } from 'express'
import express from 'express'
import * as webhookController from '../controllers/webhookController'
import { withPublicScope } from '../middleware/auth'
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

export default router

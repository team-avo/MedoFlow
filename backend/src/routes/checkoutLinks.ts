/**
 * The patient opens the checkout link from their e-mail (CTO-32). They must
 * be signed in as the cart's own patient; anyone else gets 404.
 */
import { Router } from 'express'
import { z } from 'zod'
import { Role } from '@prisma/client'
import { protect, authorize } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { openCheckoutLink } from '../services/checkoutLinkService'

const router = Router()

router.post(
  '/open',
  protect,
  authorize(Role.PATIENT),
  validateRequest({ body: z.object({ token: z.string().trim().min(1).max(128) }) }),
  asyncHandler(async (req, res) => {
    const result = await openCheckoutLink(String(req.body.token), req.user!.id)
    successResponse(res, 200, 'Checkout link', result)
  })
)

export default router

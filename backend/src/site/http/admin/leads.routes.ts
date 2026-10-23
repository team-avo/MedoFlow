/** /api/v1/site/leads — contact-form enquiries (PHI; owners + front desk). */
import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../../utils/asyncHandler'
import { successResponse } from '../../../utils/apiResponse'
import { validateRequest } from '../../../middleware/validateRequest'
import { actorFrom } from '../../actor'
import { entityId } from '../../content/primitives'
import * as leads from '../../services/leadService'
import { leadGuard } from './guards'

const router = Router()
router.use(...leadGuard)

router.get(
  '/',
  validateRequest({ query: z.object({ status: z.enum(['NEW', 'READ', 'ARCHIVED']).optional() }) }),
  asyncHandler(async (req, res) => {
    const { status } = req.query as { status?: 'NEW' | 'READ' | 'ARCHIVED' }
    successResponse(
      res,
      200,
      'Enquiries',
      await leads.listLeads(actorFrom(req).clinicId, { status })
    )
  })
)

router.get(
  '/:id',
  validateRequest({ params: z.object({ id: entityId }) }),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    successResponse(
      res,
      200,
      'Enquiry',
      await leads.readLead(actorFrom(req), String(req.params.id))
    )
  })
)

router.patch(
  '/:id',
  validateRequest({
    params: z.object({ id: entityId }),
    body: z.object({ status: z.enum(['NEW', 'READ', 'ARCHIVED']) }),
  }),
  asyncHandler(async (req, res) => {
    const out = await leads.setLeadStatus(
      actorFrom(req),
      String(req.params.id),
      (req.body as { status: 'NEW' | 'READ' | 'ARCHIVED' }).status
    )
    successResponse(res, 200, 'Enquiry updated', out)
  })
)

export default router

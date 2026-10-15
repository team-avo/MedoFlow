import { Router } from 'express'
import * as publicController from '../controllers/publicController'
import * as sitePageService from '../services/sitePageService'
import { validateRequest } from '../middleware/validateRequest'
import { withPublicScope } from '../middleware/auth'
import { publicLookupRateLimit } from '../middleware/rateLimit'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { publicAvailabilitySchema, publicSlotHoldSchema } from '../validation/module2Schemas'

const router = Router()

// Public storefront routes: these resolve the target clinic from the URL
// parameter and only expose data flagged as publicly visible. The tenant
// guard is bypassed here because there's no authenticated user — route
// handlers must scope queries explicitly by params.id.
router.use(withPublicScope('public_routes'))

router.get('/clinics', publicController.listClinics)
router.get('/clinics/:id', publicController.getClinic)
router.get('/clinics/:id/services', publicController.getClinicServices)
router.get('/clinics/:id/providers', publicController.getClinicProviders)
router.get('/clinics/:id/locations', publicController.getClinicLocations)
router.get('/clinics/:id/products', publicController.getClinicProducts)
router.get('/clinics/:id/packages', publicController.getClinicPackages)
router.get('/clinics/:id/memberships', publicController.getClinicMemberships)
router.get(
  '/clinics/:id/pages/:slug',
  asyncHandler(async (req, res) => {
    const page = await sitePageService.getPublishedBySlug(
      String(req.params['id']),
      String(req.params['slug'])
    )
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' })
      return
    }
    successResponse(res, 200, 'Page', page)
  })
)
router.get('/products/:id', publicController.getProduct)
router.get('/patients/check', publicLookupRateLimit, publicController.checkPatientExists)
router.get(
  '/availability',
  validateRequest(publicAvailabilitySchema),
  publicController.getAvailability
)
router.get('/availability/summary', publicController.getAvailableDatesSummary)
router.post('/slots/hold', validateRequest(publicSlotHoldSchema), publicController.createSlotHold)
router.delete('/slots/hold/:holdId', publicController.releaseSlotHold)

export default router

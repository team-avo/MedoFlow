import { Router } from 'express'
import { Role } from '@prisma/client'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import * as cartController from '../controllers/cartController'
import {
  itemDecisionSchema,
  itemIdParamSchema,
  shippingAddressSchema,
} from '../validation/rxCartSchemas'

const router = Router()

router.use(protect)

// GET /carts is permissive: it returns an empty payload for users without a
// clinic (see cartController.getCart). All mutations must be clinic-scoped.
router.get('/', cartController.getCart)
router.post('/items', requireClinicScope, cartController.addItem)
router.put('/items/:itemId', requireClinicScope, cartController.updateItem)
router.delete('/items/:itemId', requireClinicScope, cartController.removeItem)
router.delete('/', requireClinicScope, cartController.clearCart)
router.post('/checkout', requireClinicScope, cartController.checkout)
router.post('/checkout-demo', requireClinicScope, cartController.demoCheckout)

// Prescription → Cart, patient side (B5.3 / B5.4 / F5.2 / F5.3).
const patientOnly = [requireClinicScope, authorize(Role.PATIENT)]
router.patch(
  '/items/:itemId/decision',
  ...patientOnly,
  validateRequest({ params: itemIdParamSchema, body: itemDecisionSchema }),
  cartController.setItemDecision
)
router.get('/one-click', ...patientOnly, cartController.getOneClick)
router.post('/one-click-checkout', ...patientOnly, cartController.oneClickCheckout)
router.put(
  '/shipping-address',
  ...patientOnly,
  validateRequest({ body: shippingAddressSchema }),
  cartController.saveShippingAddress
)

export default router

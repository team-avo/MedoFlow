import { Router } from 'express'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import * as inventoryController from '../controllers/inventoryController'
import { validateRequest } from '../middleware/validateRequest'
import { adjustInventorySchema } from '../validation/rxCartSchemas'

const router = Router()

router.use(protect, requireClinicScope)

router.get('/', inventoryController.getAll)
router.get('/:productId', inventoryController.getByProductId)

router.put(
  '/:productId/adjust',
  authorize('SUPER_ADMIN'),
  validateRequest({ body: adjustInventorySchema }),
  inventoryController.adjust
)

export default router

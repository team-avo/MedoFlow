import { Router } from 'express'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import * as inventoryController from '../controllers/inventoryController'

const router = Router()

router.use(protect, requireClinicScope)

router.get('/', inventoryController.getAll)
router.get('/:productId', inventoryController.getByProductId)

router.put('/:productId/adjust', authorize('SUPER_ADMIN'), inventoryController.adjust)

export default router

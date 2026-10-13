import { Router } from 'express'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import * as productController from '../controllers/productController'

const router = Router()

router.use(protect, requireClinicScope)

router.get('/', productController.getAll)
router.get('/:id', productController.getById)

router.post('/', authorize('SUPER_ADMIN'), productController.create)
router.put('/:id', authorize('SUPER_ADMIN'), productController.update)
router.delete('/:id', authorize('SUPER_ADMIN'), productController.remove)

export default router

import { Router } from 'express'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import * as productController from '../controllers/productController'
import { validateRequest } from '../middleware/validateRequest'
import { createProductSchema, updateProductSchema } from '../validation/rxCartSchemas'

const router = Router()

router.use(protect, requireClinicScope)

router.get('/', productController.getAll)
router.get('/:id', productController.getById)

router.post(
  '/',
  authorize('SUPER_ADMIN'),
  validateRequest({ body: createProductSchema }),
  productController.create
)
router.put(
  '/:id',
  authorize('SUPER_ADMIN'),
  validateRequest({ body: updateProductSchema }),
  productController.update
)
router.delete('/:id', authorize('SUPER_ADMIN'), productController.remove)

export default router

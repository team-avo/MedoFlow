import { Router } from 'express'
import { protect, authorize, requireClinicScope } from '../middleware/auth'
import * as packageController from '../controllers/packageController'

const router = Router()

router.use(protect, requireClinicScope)

router.get('/', packageController.getAll)
router.get('/summary', authorize('SUPER_ADMIN', 'FRONT_DESK'), packageController.summary)
router.get('/:id', packageController.getById)

router.post('/', authorize('SUPER_ADMIN'), packageController.create)
router.put('/:id', authorize('SUPER_ADMIN'), packageController.update)
router.delete('/:id', authorize('SUPER_ADMIN'), packageController.remove)

export default router

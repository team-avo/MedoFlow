import { Router } from 'express'
import { Role } from '@prisma/client'
import { protect, authorize, requirePermission } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import * as staffController from '../controllers/staffController'

const router = Router()

router.use(protect)
router.use(authorize(Role.SUPER_ADMIN, Role.FRONT_DESK, Role.STAFF))
router.use(requireClinic)

// Permission-based access: SUPER_ADMIN auto-passes, STAFF users need 'staff.manage'
router.get('/', requirePermission('staff.view'), staffController.listAllStaff)
router.post('/', requirePermission('staff.manage'), staffController.createStaff)
router.patch('/:id', requirePermission('staff.manage'), staffController.updateStaff)
router.delete('/:id', requirePermission('staff.manage'), staffController.deactivateStaff)
router.post(
  '/:id/link-provider',
  requirePermission('staff.manage'),
  staffController.linkProviderToAdmin
)

export default router

import { Router } from 'express'
import { Role } from '@prisma/client'
import { protect, authorize } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import * as roleController from '../controllers/roleController'

const router = Router()

router.use(protect)
router.use(authorize(Role.SUPER_ADMIN))
router.use(requireClinic)

// Permission registry (read-only: used by the frontend to build the checkbox UI)
router.get('/permissions', roleController.getPermissionRegistry)

// Seed preset roles for this clinic
router.post('/seed-presets', roleController.seedPresets)

// CRUD
router.get('/', roleController.listRoles)
router.get('/:id', roleController.getRole)
router.post('/', roleController.createRole)
router.put('/:id', roleController.updateRole)
router.delete('/:id', roleController.deleteRole)

export default router

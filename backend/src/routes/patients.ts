import { Router } from 'express'
import { protect } from '../middleware/auth'
import { requireClinic } from '../middleware/requireClinic'
import * as patientController from '../controllers/patientController'
import { authorize, authorizeRolesOrPermission } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { clinicPatientCreateSchema } from '../validation/module2Schemas'
import { Role } from '@prisma/client'

const router = Router()

router.use(protect)
router.use(requireClinic)

router.get(
  '/',
  authorizeRolesOrPermission([Role.FRONT_DESK, Role.PROVIDER], 'patients.view'),
  patientController.listClinicPatients
)

// CTO-24: add a walk-in or phone patient at the desk (no password needed).
router.post(
  '/',
  authorizeRolesOrPermission([Role.FRONT_DESK], 'patients.create'),
  validateRequest(clinicPatientCreateSchema),
  patientController.createClinicPatient
)

router.get('/packages', authorize(Role.PATIENT), patientController.getMyPackages)
router.get('/entitlements', authorize(Role.PATIENT), patientController.getMyEntitlements)
router.get(
  '/:patientId/entitlements',
  authorize(Role.FRONT_DESK, Role.SUPER_ADMIN, Role.PROVIDER),
  patientController.getPatientEntitlements
)

export default router

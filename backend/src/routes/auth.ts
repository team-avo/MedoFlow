import { Router } from 'express'
import * as authController from '../controllers/authController'
import { protect, withPublicScope } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { patientRegistrationSchema } from '../validation/module1Schemas'
import { authRateLimit, refreshRateLimit } from '../middleware/rateLimit'

const router = Router()

// Pre-auth endpoints run outside any clinic scope — they have to, the user
// isn't authenticated yet. Wrap them in a named bypass so the Prisma guard
// permits the email/token/clinic lookups these flows perform.
router.post(
  '/register',
  withPublicScope('auth.register'),
  authRateLimit,
  validateRequest(patientRegistrationSchema),
  authController.register
)
router.post('/login', withPublicScope('auth.login'), authRateLimit, authController.login)
router.post(
  '/mfa/verify',
  withPublicScope('auth.mfa_verify'),
  authRateLimit,
  authController.verifyMfaLogin
)
router.post(
  '/set-password',
  withPublicScope('auth.set_password'),
  authRateLimit,
  authController.setPassword
)
router.post(
  '/refresh-token',
  withPublicScope('auth.refresh_token'),
  authController.requireClientHeader,
  refreshRateLimit,
  authController.refreshToken
)
router.post(
  '/logout',
  withPublicScope('auth.logout'),
  authController.requireClientHeader,
  authController.logout
)

// Authenticated endpoints: protect sets the ALS context automatically.
router.get('/me', protect, authController.me)
router.get('/session', protect, authController.sessionHeartbeat)
router.patch('/me', protect, authController.updateMe)
router.post('/patient-tour-seen', protect, authController.markPatientTourSeen)
router.post('/change-password', protect, authRateLimit, authController.changePassword)

router.post('/mfa/setup', protect, authController.mfaSetup)
router.post('/mfa/enable', protect, authRateLimit, authController.mfaEnable)
router.post('/mfa/disable', protect, authRateLimit, authController.mfaDisable)

router.get('/break-glass', protect, authController.breakGlassStatus)
router.post('/break-glass', protect, authController.breakGlassActivate)
router.delete('/break-glass', protect, authController.breakGlassEnd)

export default router

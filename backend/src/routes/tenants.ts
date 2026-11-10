import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler'
import { successResponse } from '../utils/apiResponse'
import { validateRequest } from '../middleware/validateRequest'
import { authRateLimit } from '../middleware/rateLimit'
import { withPublicScope } from '../middleware/auth'
import { siteBaseUrls } from '../site/services/domainService'
import * as tenantService from '../services/tenantService'
import { PLANS, SELF_SERVE_PLANS, planCatalog } from '../config/plans'

const router = Router()

// Signup flow creates the first tenant/clinic/user before any user context
// exists. The whole router runs in bypass scope; the service layer is
// trusted to stamp tenantId on everything it creates.
router.use(withPublicScope('tenant_signup'))

const signupSchema = z.object({
  ownerName: z.string().min(2).max(100),
  ownerEmail: z.string().email(),
  password: z.string().min(8).max(128),
  clinicName: z.string().min(2).max(100),
  clinicEmail: z.string().email(),
  subdomain: z.string().min(3).max(63),
  // WS4: the plan picked on the pricing page. Enterprise is sales-led.
  plan: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined || (SELF_SERVE_PLANS as string[]).includes(v)) return
      ctx.addIssue({
        code: 'custom',
        message: PLANS.some((p) => p.key === v)
          ? 'This plan is set up with our team — contact sales.'
          : 'Unknown plan',
      })
    }),
})

const subdomainCheckSchema = z.object({
  subdomain: z.string().min(3).max(63),
})

// GET /api/v1/tenants/plans — the pricing page and the sign-up plan picker.
router.get('/plans', (_req, res) => {
  successResponse(res, 200, 'Plans', planCatalog())
})

// POST /api/v1/tenants/signup
router.post(
  '/signup',
  authRateLimit,
  validateRequest({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const result = await tenantService.provisionTenant(req.body as tenantService.SignupData)
    successResponse(res, 201, 'Clinic created successfully. Welcome to MedoFlow!', {
      tenantId: result.tenant.id,
      plan: result.tenant.plan,
      status: result.tenant.status,
      trialEndsAt: result.tenant.trialEndsAt,
      clinicId: result.clinic.id,
      subdomain: result.subdomain,
      dashboardUrl: `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')}/dashboard`,
      // The clinic's public website (Component 8).
      siteUrl: (await siteBaseUrls(result.clinic.id)).canonical,
      user: result.user,
    })
  })
)

// GET /api/v1/tenants/check-subdomain?subdomain=xyz
router.get(
  '/check-subdomain',
  asyncHandler(async (req, res) => {
    const parsed = subdomainCheckSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid subdomain parameter' })
      return
    }
    const available = await tenantService.checkSubdomainAvailability(parsed.data.subdomain)
    successResponse(res, 200, 'Subdomain checked', { available })
  })
)

// GET /api/v1/tenants/resolve?subdomain=xyz
// Used by the storefront middleware to resolve tenant config from host header
router.get(
  '/resolve',
  asyncHandler(async (req, res) => {
    const subdomain = req.query['subdomain']
    if (typeof subdomain !== 'string') {
      res.status(400).json({ success: false, error: 'subdomain required' })
      return
    }
    const brand = await tenantService.getTenantBySubdomain(subdomain)
    if (!brand) {
      res.status(404).json({ success: false, error: 'Tenant not found' })
      return
    }
    successResponse(res, 200, 'Tenant resolved', { brand })
  })
)

export default router

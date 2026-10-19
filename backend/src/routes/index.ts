import { Router } from 'express'
import healthRoutes from './health'
import authRoutes from './auth'
import clinicRoutes from './clinics'
import disciplineRoutes from './disciplines'
import providerRoutes from './providers'
import locationRoutes from './locations'
import serviceRoutes from './services'
import appointmentRoutes from './appointments'
import visitRoutes from './visits'
import prescriptionRoutes from './prescriptions'
import publicRoutes from './public'
import waitlistRoutes from './waitlist'
import paymentRoutes from './payments'
import treatmentPlanRoutes from './treatmentPlans'
import fileRoutes from './files'
import formRoutes from './forms'
import invoiceRoutes from './invoices'
import analyticsRoutes from './analytics'
import aiScribeRoutes from './aiScribe'
import googleCalendarRoutes from './googleCalendar'
import staffRoutes from './staff'
import consultationRoutes, { appointmentConsultationRouter } from './consultations'

import productRoutes from './products'
import rxCartRoutes from './rxCart'
import inventoryRoutes from './inventory'
import packageRoutes from './packages'
import membershipRoutes from './memberships'
import cartRoutes from './carts'
import webhookRoutes from './webhooks'
import commissionRoutes from './commissions'
import auditRoutes from './audit'
import patientRoutes from './patients'
import roleRoutes from './roles'
import tenantRoutes from './tenants'
import onboardingRoutes from './onboarding'
import platformRoutes from './platform'
import lifecycleRoutes from './lifecycle'
import sitePagesRoutes from './sitePages'
import voiceAgentRoutes from './voiceAgent'

const router = Router()

router.use('/tenants', tenantRoutes)
router.use('/webhooks', webhookRoutes)
router.use('/commissions', commissionRoutes)
router.use('/audit', auditRoutes)
router.use('/patients', patientRoutes)
router.use('/health', healthRoutes)
router.use('/public', publicRoutes)
router.use('/auth', authRoutes)
router.use('/clinics', clinicRoutes)
router.use('/disciplines', disciplineRoutes)
router.use('/providers', providerRoutes)
router.use('/locations', locationRoutes)
router.use('/services', serviceRoutes)
router.use('/appointments', appointmentRoutes)
router.use('/appointments', appointmentConsultationRouter)
router.use('/visits', visitRoutes)
router.use('/prescriptions', prescriptionRoutes)
router.use('/waitlist', waitlistRoutes)
router.use('/payments', paymentRoutes)
router.use('/treatment-plans', treatmentPlanRoutes)
router.use('/files', fileRoutes)
router.use('/forms', formRoutes)
router.use('/invoices', invoiceRoutes)
router.use('/analytics', analyticsRoutes)
router.use('/ai-scribe', aiScribeRoutes)
router.use('/integrations/google', googleCalendarRoutes)
router.use('/staff', staffRoutes)
router.use('/consultations', consultationRoutes)
router.use('/products', productRoutes)
router.use('/rx-cart', rxCartRoutes)
router.use('/inventory', inventoryRoutes)
router.use('/packages', packageRoutes)
router.use('/memberships', membershipRoutes)
router.use('/carts', cartRoutes)
router.use('/roles', roleRoutes)
router.use('/onboarding', onboardingRoutes)
router.use('/platform/lifecycle', lifecycleRoutes)
router.use('/platform', platformRoutes)
router.use('/site-pages', sitePagesRoutes)
router.use('/voice-agent', voiceAgentRoutes)

export default router

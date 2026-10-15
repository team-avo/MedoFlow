/**
 * Environment for the integration suites. Runs before any app module is
 * imported, so config/prisma.ts picks up the app-role DATABASE_URL.
 */
import crypto from 'crypto'

const appUrl = process.env.INTEGRATION_DATABASE_URL
const adminUrl = process.env.INTEGRATION_ADMIN_DATABASE_URL
if (!appUrl || !adminUrl) {
  throw new Error(
    'Integration tests need INTEGRATION_DATABASE_URL (medoflow_app role) and ' +
      'INTEGRATION_ADMIN_DATABASE_URL (owner). See development-log-docs/backend-foundation-B0-WALKTHROUGH-AND-VERIFICATION.md.'
  )
}

process.env.DATABASE_URL = appUrl
process.env.NODE_ENV = 'test'
process.env.TENANT_ISOLATION_MODE = 'enforce'
process.env.TENANT_RLS = 'on'
process.env.CORS_ORIGIN = 'http://localhost:3000'
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex')
process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
process.env.SESSION_IDLE_TIMEOUT_MINUTES = process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? '15'
// Suites make many deliberate failed logins; rateLimit.int.test.ts restores the real limits.
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.REFRESH_RATE_LIMIT_MAX = '1000'
process.env.PUBLIC_LOOKUP_RATE_LIMIT_MAX = '1000'
delete process.env.STRIPE_WEBHOOK_SECRET
delete process.env.ALERT_WEBHOOK_URL
delete process.env.REDIS_URL

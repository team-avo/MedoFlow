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
// B3.2: field-level encryption with a throwaway key per run.
process.env.FIELD_ENCRYPTION_PROVIDER = 'env'
process.env.FIELD_ENCRYPTION_KEYS = `it1:${crypto.randomBytes(32).toString('hex')}`
process.env.FIELD_ENCRYPTION_ACTIVE_KID = 'it1'
// B3.1: patient files use the local presigned-URL driver. Empty (not unset)
// so a developer's .env cannot point the suites at a real bucket.
process.env.S3_ACCESS_KEY_ID = ''
process.env.S3_SECRET_ACCESS_KEY = ''
process.env.FILE_BLOB_SIGNING_SECRET = crypto.randomBytes(32).toString('hex')
process.env.SESSION_IDLE_TIMEOUT_MINUTES = process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? '15'
// Suites make many deliberate failed logins; rateLimit.int.test.ts restores the real limits.
process.env.AUTH_RATE_LIMIT_MAX = '1000'
process.env.REFRESH_RATE_LIMIT_MAX = '1000'
process.env.PUBLIC_LOOKUP_RATE_LIMIT_MAX = '1000'
process.env.PUBLIC_API_RATE_LIMIT_MAX = '100000'
process.env.SITE_RENDER_RATE_LIMIT_MAX = '100000'
process.env.SITE_LEAD_RATE_LIMIT_MAX = '1000'
// C8: clinic subdomains under 'site.test' in the suites.
process.env.SITE_ROOT_DOMAIN = 'site.test'
process.env.APP_HOSTS = 'app.site.test,localhost,127.0.0.1'
process.env.DOMAIN_PROVIDER = 'manual'
process.env.SITE_PREVIEW_SECRET = crypto.randomBytes(32).toString('hex')
delete process.env.STRIPE_WEBHOOK_SECRET
delete process.env.ALERT_WEBHOOK_URL
delete process.env.REDIS_URL
// Component 2: the deterministic in-process scribe AI; nothing leaves the machine.
process.env.AI_SCRIBE_LLM_PROVIDER = 'mock'
process.env.AI_SCRIBE_STT_PROVIDER = 'mock'
delete process.env.AI_SCRIBE_DEMO_ENABLED
delete process.env.AI_SCRIBE_BAA_HOSTS

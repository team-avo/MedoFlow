import { getIsolationMode } from './tenantContext'
import { jwtSecretWeakness } from '../utils/tokenUtils'
import { getAuditRetentionYears, MIN_AUDIT_RETENTION_YEARS } from '../services/auditService'
import { isSecretBoxConfigured } from '../utils/secretBox'
import { getSseMode, isS3Configured } from '../services/fileStorage/s3Driver'
import { fieldEncryptionConfigProblem } from './fieldKeys'

/**
 * Configuration problems found at boot. `fatal` entries stop a production
 * boot; outside production they are printed as warnings so local
 * development keeps working.
 */
export interface EnvProblem {
  fatal: boolean
  message: string
}

export const collectEnvProblems = (env: NodeJS.ProcessEnv = process.env): EnvProblem[] => {
  const problems: EnvProblem[] = []
  const fatal = (message: string) => problems.push({ fatal: true, message })
  const warn = (message: string) => problems.push({ fatal: false, message })

  for (const name of ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN']) {
    if (!env[name]) fatal(`${name} is required`)
  }

  // B0.2.1 — signing-secret strength (current and, during rotation, previous).
  const weak = jwtSecretWeakness(env.JWT_SECRET)
  if (env.JWT_SECRET && weak) fatal(`JWT_SECRET ${weak}. Generate one with: openssl rand -hex 32`)
  if (env.JWT_SECRET_PREVIOUS) {
    const weakPrev = jwtSecretWeakness(env.JWT_SECRET_PREVIOUS)
    if (weakPrev) fatal(`JWT_SECRET_PREVIOUS ${weakPrev}`)
  }

  // B0.1.1 — tenant isolation must be enforcing.
  if (getIsolationMode() !== 'enforce') {
    fatal(
      `TENANT_ISOLATION_MODE is "${env.TENANT_ISOLATION_MODE}"; it must be "enforce" (or unset, which defaults to enforce)`
    )
  }

  // B0.1.3 — RLS must be applied by the app (the role check runs after connect).
  if ((env.TENANT_RLS ?? 'on').toLowerCase() === 'off') {
    fatal('TENANT_RLS=off disables Postgres row-level security; remove it')
  }

  // B0.3.6 — audit retention.
  const years = getAuditRetentionYears()
  if (!(years >= MIN_AUDIT_RETENTION_YEARS)) {
    fatal(`AUDIT_RETENTION_YEARS must be ≥ ${MIN_AUDIT_RETENTION_YEARS} (HIPAA §164.316(b)(2))`)
  }

  // B0.2.2 — MFA needs its encryption key; without it MFA endpoints answer 503.
  if (!isSecretBoxConfigured()) {
    warn('MFA_ENCRYPTION_KEY is not set (64 hex chars) — staff MFA enrolment is unavailable')
  }

  // B3.1 — patient files live in object storage, reached only through
  // presigned URLs. Local disk is ephemeral on the host and unencrypted.
  if (!isS3Configured(env)) {
    fatal(
      'S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set — patient files would be written to local disk'
    )
  }
  try {
    getSseMode(env)
  } catch (e) {
    fatal((e as Error).message)
  }

  // B3.2 — transcripts, SOAP notes and intake answers are sealed with
  // field-level encryption; production refuses to store them in the clear.
  const fieldKeyProblem = fieldEncryptionConfigProblem(env)
  if (fieldKeyProblem) fatal(fieldKeyProblem)

  if (!env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET) {
    warn('STRIPE_SECRET_KEY is not set — Stripe payment features will not function')
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    warn(
      'STRIPE_WEBHOOK_SECRET is not set — Stripe webhook signature verification is DISABLED. ' +
        'Any party can send spoofed webhook events. Set this before accepting live payments.'
    )
  }
  if (!env.ALERT_WEBHOOK_URL) {
    warn('ALERT_WEBHOOK_URL is not set — security alerts go to the log stream only')
  }
  return problems
}

/**
 * Boot validation. Fails fast in production on any fatal problem; prints
 * everything as a warning elsewhere.
 */
export const validateProductionEnv = (): void => {
  const isProduction = process.env.NODE_ENV === 'production'
  const problems = collectEnvProblems()
  for (const p of problems) {
    console.warn(`[${p.fatal && isProduction ? 'FATAL' : 'WARN'}] ${p.message}`)
  }
  if (isProduction && problems.some((p) => p.fatal)) {
    console.error('[FATAL] Refusing to start: fix the configuration problems above.')
    process.exit(1)
  }
}

/**
 * B0.1.3 — after the database connects: RLS only engages when the app role
 * is neither superuser nor BYPASSRLS. Fatal in production.
 */
export const validateDatabaseRole = (info: {
  role: string
  superuser: boolean
  bypassRls: boolean
}): void => {
  if (!info.superuser && !info.bypassRls) {
    console.warn(`[db] connected as "${info.role}" — row-level security is enforced`)
    return
  }
  const message =
    `DATABASE_URL connects as "${info.role}" (${info.superuser ? 'superuser' : 'BYPASSRLS'}), ` +
    'so Postgres row-level security does not apply. Connect as the medoflow_app role ' +
    '(see development-log-docs/backend-foundation-B0-WALKTHROUGH-AND-VERIFICATION.md) and keep the owner ' +
    'role in MIGRATION_DATABASE_URL.'
  if (process.env.NODE_ENV === 'production') {
    console.error(`[FATAL] ${message}`)
    process.exit(1)
  }
  console.warn(`[WARN] ${message}`)
}

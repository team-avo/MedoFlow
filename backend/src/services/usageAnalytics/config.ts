/**
 * CTO-39 usage analytics: environment and boot checks.
 *
 * Usage events go to PostHog (US Cloud) server-side only. They carry no PHI by
 * design (see `usageAnalytics.ts`), so there is no BAA; `USAGE_ANALYTICS_POLICY`
 * records that decision and a production boot refuses to send without it.
 */

export const USAGE_ANALYTICS_POLICIES = ['no-phi'] as const

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
export const DEFAULT_POSTHOG_APP_HOST = 'https://us.posthog.com'

const MIN_SALT_LENGTH = 32

export interface UsageAnalyticsConfig {
  apiKey: string
  host: string
  salt: string
  env: string
}

export interface UsageQueryConfig {
  appHost: string
  projectId: string
  personalApiKey: string
  env: string
}

const clean = (v: string | undefined): string => v?.trim() ?? ''

/** `demo`, `production`, `development`: lower-case, short, safe to put in a query. */
export const usageEnvName = (env: NodeJS.ProcessEnv = process.env): string => {
  const raw = clean(env.USAGE_ANALYTICS_ENV).toLowerCase() || clean(env.NODE_ENV).toLowerCase()
  return /^[a-z0-9-]{1,20}$/.test(raw) ? raw : 'development'
}

/** Ingest config, or null when usage analytics is off (the default). */
export const usageAnalyticsConfig = (
  env: NodeJS.ProcessEnv = process.env
): UsageAnalyticsConfig | null => {
  if (env.NODE_ENV === 'test') return null
  const apiKey = clean(env.POSTHOG_API_KEY)
  const salt = clean(env.USAGE_ANALYTICS_SALT)
  if (!apiKey || salt.length < MIN_SALT_LENGTH) return null
  if (env.NODE_ENV === 'production' && !isNoPhiPolicy(env)) return null
  return {
    apiKey,
    host: clean(env.POSTHOG_HOST) || DEFAULT_POSTHOG_HOST,
    salt,
    env: usageEnvName(env),
  }
}

/** Read-side config for the platform Usage page, or null when not set up. */
export const usageQueryConfig = (env: NodeJS.ProcessEnv = process.env): UsageQueryConfig | null => {
  const projectId = clean(env.POSTHOG_PROJECT_ID)
  const personalApiKey = clean(env.POSTHOG_PERSONAL_API_KEY)
  if (!projectId || !personalApiKey || !/^\d+$/.test(projectId)) return null
  return {
    appHost: (clean(env.POSTHOG_APP_HOST) || DEFAULT_POSTHOG_APP_HOST).replace(/\/+$/, ''),
    projectId,
    personalApiKey,
    env: usageEnvName(env),
  }
}

const isNoPhiPolicy = (env: NodeJS.ProcessEnv): boolean =>
  (USAGE_ANALYTICS_POLICIES as readonly string[]).includes(clean(env.USAGE_ANALYTICS_POLICY))

/**
 * Boot-time checks (envValidation). `fatal` stops a production boot; outside
 * production it is printed as a warning. Messages name variables, never values.
 */
export function usageAnalyticsConfigProblems(
  env: NodeJS.ProcessEnv = process.env
): { fatal: boolean; message: string }[] {
  const names = [
    'POSTHOG_API_KEY',
    'USAGE_ANALYTICS_SALT',
    'POSTHOG_PROJECT_ID',
    'POSTHOG_PERSONAL_API_KEY',
  ]
  if (!names.some((n) => clean(env[n]))) {
    return [
      { fatal: false, message: 'POSTHOG_API_KEY is not set: usage analytics (CTO-39) is off' },
    ]
  }

  const problems: { fatal: boolean; message: string }[] = []
  const hasKey = !!clean(env.POSTHOG_API_KEY)
  if (hasKey) {
    if (clean(env.USAGE_ANALYTICS_SALT).length < MIN_SALT_LENGTH) {
      problems.push({
        fatal: true,
        message: `USAGE_ANALYTICS_SALT must be at least ${MIN_SALT_LENGTH} characters (openssl rand -hex 32); staff ids are hashed with it`,
      })
    }
    if (env.NODE_ENV === 'production' && !isNoPhiPolicy(env)) {
      problems.push({
        fatal: true,
        message:
          'USAGE_ANALYTICS_POLICY must be "no-phi": usage events go to PostHog without a BAA and must never carry PHI',
      })
    }
    if (!clean(env.USAGE_ANALYTICS_ENV)) {
      problems.push({
        fatal: false,
        message: 'USAGE_ANALYTICS_ENV is not set: usage events are tagged with NODE_ENV',
      })
    }
  } else {
    problems.push({
      fatal: false,
      message: 'POSTHOG_API_KEY is not set: no usage events are sent (the Usage page only reads)',
    })
  }

  const queryNames = ['POSTHOG_PROJECT_ID', 'POSTHOG_PERSONAL_API_KEY']
  const querySet = queryNames.filter((n) => clean(env[n]))
  if (querySet.length < queryNames.length) {
    problems.push({
      fatal: false,
      message:
        'POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY are not both set: the platform Usage page is disabled',
    })
  } else if (!/^\d+$/.test(clean(env.POSTHOG_PROJECT_ID))) {
    problems.push({ fatal: false, message: 'POSTHOG_PROJECT_ID must be the numeric project id' })
  }
  return problems
}

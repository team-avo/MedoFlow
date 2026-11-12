/**
 * MedoFlow API edge Worker (Cloudflare).
 *
 * Fronts the Express API, which runs unchanged inside a Cloudflare Container
 * (`BackendContainer`, built from ../Dockerfile). The edge layer owns the
 * concerns that must hold even before the container is reachable:
 *   - HTTPS-only: plain-HTTP requests are redirected (GET/HEAD) or refused.
 *   - Origin allow-list: a browser request from an Origin not in CORS_ORIGIN
 *     is rejected with 403 before it reaches the API.
 *   - /api/v1/edge/health: edge liveness.
 *   - /api/v1/edge/db: Postgres read+write round-trip through Hyperdrive.
 *   - cron: keeps the single backend instance warm so its node-cron jobs and
 *     BullMQ worker keep running.
 *
 * The `BACKEND` binding only exists in the `container` wrangler env (Workers
 * Paid). Without it every other /api route answers 503 instead of pretending.
 */
import { Container, getContainer } from '@cloudflare/containers'
import { Client } from 'pg'

/** Secrets/vars forwarded into the container's process.env. */
const CONTAINER_ENV_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'CORS_ORIGIN',
  'FRONTEND_URL',
  'APP_URL',
  'REDIS_URL',
  'TENANT_ISOLATION_MODE',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'JAAS_APP_ID',
  'JAAS_KID',
  'JAAS_PRIVATE_KEY',
] as const

type ContainerEnvKey = (typeof CONTAINER_ENV_KEYS)[number]

export interface Env extends Partial<Record<ContainerEnvKey, string>> {
  HYPERDRIVE: Hyperdrive
  FILES: R2Bucket
  CF_VERSION_METADATA: WorkerVersionMetadata
  BACKEND?: DurableObjectNamespace<BackendContainer>
  CORS_ORIGIN?: string
}

/** Single named instance: node-cron + the BullMQ worker must not run twice. */
const PRIMARY_INSTANCE = 'primary'
const API_PREFIX = '/api/v1'

export class BackendContainer extends Container<Env> {
  override defaultPort = 3000
  override sleepAfter = '15m'

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env)
    const vars: Record<string, string> = { PORT: '3000' }
    for (const key of CONTAINER_ENV_KEYS) {
      const value = env[key]
      if (value) vars[key] = value
    }
    this.envVars = vars
  }

  override onError(error: unknown): never {
    console.error('[backend-container] error', error instanceof Error ? error.message : error)
    throw error
  }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    },
  })
}

function allowedOrigins(env: Env): string[] {
  return (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

/** Postgres round-trip via Hyperdrive. The write lands in a temp table that is
 *  dropped on commit, so the check never leaves rows behind. */
async function dbRoundTrip(env: Env): Promise<Response> {
  const started = Date.now()
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
  try {
    await client.connect()
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE edge_healthcheck (id int, at timestamptz) ON COMMIT DROP')
    const nonce = Math.floor(Math.random() * 1_000_000)
    await client.query('INSERT INTO edge_healthcheck VALUES ($1, now())', [nonce])
    const written = await client.query<{ id: number }>('SELECT id FROM edge_healthcheck')
    const read = await client.query<{ n: string; m: string }>(
      'SELECT (SELECT count(*) FROM "Clinic") AS n, (SELECT count(*) FROM _prisma_migrations) AS m'
    )
    await client.query('COMMIT')
    return json(200, {
      success: true,
      message: 'Postgres reachable via Hyperdrive',
      data: {
        write: written.rows[0]?.id === nonce,
        clinics: Number(read.rows[0]?.n ?? 0),
        migrations: Number(read.rows[0]?.m ?? 0),
        latencyMs: Date.now() - started,
      },
    })
  } catch (err) {
    console.error('[edge/db] round-trip failed', err instanceof Error ? err.message : err)
    return json(503, { success: false, message: 'Database round-trip failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // TLS only. workers.dev / custom domains also answer on port 80.
    if (url.protocol === 'http:') {
      if (request.method === 'GET' || request.method === 'HEAD') {
        url.protocol = 'https:'
        return Response.redirect(url.toString(), 301)
      }
      return json(403, { success: false, message: 'HTTPS required' })
    }

    const origin = request.headers.get('origin')
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json(403, { success: false, message: 'Origin not allowed' })
    }

    if (url.pathname === `${API_PREFIX}/edge/health`) {
      return json(200, {
        success: true,
        message: 'MedoFlow edge is operational',
        data: {
          backend: env.BACKEND ? 'container' : 'not-deployed',
          version: env.CF_VERSION_METADATA.id,
          timestamp: new Date().toISOString(),
        },
      })
    }
    if (url.pathname === `${API_PREFIX}/edge/db`) {
      return dbRoundTrip(env)
    }

    if (!env.BACKEND) {
      return json(503, {
        success: false,
        message: 'Backend container is not deployed on this environment',
      })
    }
    ctx.passThroughOnException()
    return getContainer(env.BACKEND, PRIMARY_INSTANCE).fetch(request)
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    if (!env.BACKEND) return
    const res = await getContainer(env.BACKEND, PRIMARY_INSTANCE).fetch(
      new Request(`https://backend.internal${API_PREFIX}/health`)
    )
    if (!res.ok) console.error('[edge/cron] backend health returned', res.status)
  },
} satisfies ExportedHandler<Env>

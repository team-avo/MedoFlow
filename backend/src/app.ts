import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import routes from './routes'
import { errorHandler } from './middleware/errorHandler'
import type { ApiError } from './types/errors'
import { scrubUrl } from './utils/phiScrubber'
import { isClinicSiteOrigin, matchesStaticPolicy, parseCorsOrigins } from './site/cors'

const app = express()

// Behind Render's proxy (and Cloudflare in front of it) req.ip must be the
// client, not the proxy: rate limits and failed-login tracking key on it
// (B8.2). TRUST_PROXY = number of proxy hops; 1 by default in production.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '')
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)

// HSTS: one year, all subdomains (clinic sites live on subdomains too).
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true } }))
const corsPolicy = parseCorsOrigins(process.env.CORS_ORIGIN)
const isProduction = process.env.NODE_ENV === 'production'
const hasStaticPolicy = corsPolicy.exact.size > 0 || corsPolicy.wildcards.length > 0
app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / server-side requests (no origin) are allowed
      if (!origin) {
        cb(null, true)
        return
      }
      // In development, allow localhost when CORS_ORIGIN is not set
      if (!isProduction && !hasStaticPolicy) {
        const isLocalhost =
          origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
        if (isLocalhost) {
          cb(null, true)
          return
        }
      }
      // In production, require CORS_ORIGIN to be set; fail closed if not
      if (isProduction && !hasStaticPolicy) {
        cb(null, false)
        return
      }
      if (matchesStaticPolicy(origin, corsPolicy)) {
        cb(null, true)
        return
      }
      // Clinic websites on their own domains (B8.2): verified hosts only.
      isClinicSiteOrigin(origin, isProduction).then(
        (ok) => cb(null, ok),
        () => cb(null, false)
      )
    },
    credentials: true,
  })
)
// Request log with every query-string value masked (B0.3.5): e.g.
// /public/patients/check?email=… must never write the address to the log drain.
morgan.token('safe-url', (req) => scrubUrl((req as express.Request).originalUrl ?? req.url ?? ''))
app.use(
  morgan(
    ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
    { skip: () => process.env.NODE_ENV === 'test' }
  )
)
// Raised limit to accept base64 logo data-URLs during onboarding (<=2 MB raw → ~2.7 MB encoded).
// The Stripe webhook is skipped: signature verification needs the raw body,
// which routes/webhooks.ts reads with express.raw().
const jsonParser = express.json({ limit: '6mb' })
app.use((req, res, next) => {
  if (req.path === '/api/v1/webhooks/stripe') return next()
  jsonParser(req, res, next)
})
app.use(cookieParser())

app.use('/api/v1', routes)

app.use((_req, _res, next) => {
  const err = new Error('Not Found') as ApiError
  err.statusCode = 404
  next(err)
})

app.use(errorHandler)

export default app

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

const app = express()

app.use(helmet())
const corsOrigin = process.env.CORS_ORIGIN
const isProduction = process.env.NODE_ENV === 'production'
app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = corsOrigin
        ? corsOrigin
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : []
      // In production, require CORS_ORIGIN to be set; fail closed if not
      if (isProduction && allowed.length === 0) {
        cb(null, false)
        return
      }
      // Same-origin / server-side requests (no origin) are allowed
      if (!origin) {
        cb(null, true)
        return
      }
      // In development, allow localhost when CORS_ORIGIN is not set
      if (!isProduction && allowed.length === 0) {
        const isLocalhost =
          origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
        cb(null, isLocalhost)
        return
      }
      const isVercelPreview = origin.endsWith('.vercel.app')
      const isAllowed =
        allowed.includes(origin) ||
        (isVercelPreview && allowed.some((o) => o.includes('vercel.app')))
      cb(null, isAllowed)
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

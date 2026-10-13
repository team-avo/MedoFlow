import rateLimit from 'express-rate-limit'

/**
 * Login rate limiter: 5 failed attempts per 15 minutes per IP.
 * Brute-force defense — counts only failures so legit users who mistype once
 * or twice don't burn the budget.
 *
 * In production this should use a Redis store so limits survive restarts
 * and work across multiple API instances.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Shared by /login, /mfa/verify, /mfa/enable|disable, /change-password,
  // /register, /set-password and tenant signup: one failure budget per IP.
  // AUTH_RATE_LIMIT_MAX overrides the default of 5 (read per request).
  max: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  standardHeaders: true, // Return rate-limit headers (RateLimit-*)
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many attempts. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: true, // Only count failed requests toward the limit
})

/**
 * Refresh-token rate limiter: separate, more permissive bucket.
 *
 * Why: /refresh-token legitimately 401s when called with no/expired cookie
 * (e.g. right after logout, or in dev with HMR re-rendering auth providers).
 * Those 401s aren't brute-force attempts on a password, so they should NOT
 * share the /login 5-per-15-min budget. We still rate-limit to prevent abuse,
 * just at a sensible ceiling.
 */
export const refreshRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: () => Number(process.env.REFRESH_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many refresh attempts. Please slow down.',
  },
})

/**
 * General API rate limiter: 200 requests per minute per IP.
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
  },
})

/**
 * Public look-ups that reveal whether an account exists (e.g.
 * /public/patients/check). 30 per 15 minutes per IP slows enumeration
 * without affecting a real booking flow (B0.1.4).
 */
export const publicLookupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => Number(process.env.PUBLIC_LOOKUP_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
})

/**
 * Client-side PHI scrubbing (F0.3.2 / F0.3.3). Mirrors backend/src/utils/phiScrubber.ts.
 *
 * Everything the browser writes to the console, and any telemetry payload a
 * future monitoring SDK would send, passes through here first:
 *  - key-based: properties whose names commonly hold PHI or secrets are
 *    replaced with '[REDACTED]' wherever they appear (deep);
 *  - pattern-based: free text has emails, phone numbers, SSNs, card numbers
 *    and JWTs masked.
 *
 * Identifiers (cuid ids) are kept: they are needed to debug and are not PHI
 * on their own.
 */

const REDACTED = '[REDACTED]'

const PHI_KEYS = new Set([
  'name',
  'firstname',
  'lastname',
  'fullname',
  'patientname',
  'providername',
  'email',
  'patientemail',
  'phone',
  'phonenumber',
  'mobile',
  'dob',
  'dateofbirth',
  'birthdate',
  'address',
  'street',
  'ssn',
  'subjective',
  'objective',
  'assessment',
  'plan',
  'note',
  'notes',
  'transcript',
  'summary',
  'patientsummary',
  'aidraft',
  'answers',
  'responses',
  'diagnosis',
  'medication',
  'instructions',
  'reason',
  'body',
  'content',
  'data',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'mfatoken',
  'authorization',
  'cookie',
  'secret',
  'clientsecret',
  'recoverycode',
  'recoverycodes',
  'code',
])

/** Keys that must stay readable even though they look PHI-ish. */
const SAFE_KEYS = new Set(['statuscode', 'errorcode'])

export function isPhiKey(key: string): boolean {
  const k = key.toLowerCase()
  if (SAFE_KEYS.has(k)) return false
  return PHI_KEYS.has(k)
}

const TEXT_PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD]'],
  [/(?:\+?\d{1,2}[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[PHONE]'],
]

export function scrubText(text: string): string {
  let out = text
  for (const [re, replacement] of TEXT_PATTERNS) out = out.replace(re, replacement)
  return out
}

/** Deep-scrubs a value. Never throws; cycles and depth are bounded. */
export function scrubPhi(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value
  if (typeof value === 'string') return scrubText(value)
  if (typeof value !== 'object') return value
  if (depth > 6) return '[TRUNCATED]'
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map((v) => scrubPhi(v, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = isPhiKey(k) ? REDACTED : scrubPhi(v, depth + 1, seen)
  }
  return out
}

/**
 * Reduce any thrown value to a small, PHI-free summary. Axios errors carry
 * the request config (body, headers incl. Authorization) and the response
 * body — none of that may reach a log, so only status/code/name survive.
 */
export function describeError(err: unknown): Record<string, string | number> {
  if (err == null) return {}
  if (typeof err !== 'object') return { message: scrubText(String(err)).slice(0, 200) }
  const e = err as {
    name?: unknown
    message?: unknown
    code?: unknown
    response?: { status?: unknown; data?: { code?: unknown } }
  }
  const out: Record<string, string | number> = {}
  if (typeof e.name === 'string') out.name = e.name
  if (typeof e.response?.status === 'number') out.status = e.response.status
  const apiCode = e.response?.data?.code
  if (typeof apiCode === 'string') out.code = apiCode
  else if (typeof e.code === 'string') out.code = e.code
  if (typeof e.message === 'string') out.message = scrubText(e.message).slice(0, 200)
  return out
}

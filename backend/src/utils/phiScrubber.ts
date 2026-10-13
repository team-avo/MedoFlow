/**
 * PHI scrubbing for everything that leaves the process as a log line, an
 * error response or a monitoring payload (B0.3.5). Two layers:
 *
 *  - key-based: object properties whose names commonly hold PHI or secrets
 *    are replaced with '[REDACTED]' wherever they appear (deep);
 *  - pattern-based: free text (error messages, stack traces, Prisma error
 *    dumps that echo query arguments) has emails, phone numbers, SSNs, card
 *    numbers, dates of birth and quoted values after PHI-like keys masked.
 *
 * Identifiers (cuid ids) are deliberately kept: they are needed to debug and
 * are not PHI on their own.
 */

const REDACTED = '[REDACTED]'

const PHI_KEYS = new Set(
  [
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
    'mailingaddress',
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
    'timeline',
    'answers',
    'responses',
    'diagnosis',
    'medication',
    'instructions',
    'reason',
    'body',
    'content',
    'callername',
    'callerphone',
    'password',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'secret',
    'mfasecret',
    'recoverycode',
  ].map((k) => k.toLowerCase())
)

/** Keys that must stay readable even though they look PHI-ish. */
const SAFE_KEYS = new Set(['statuscode', 'code_name', 'errorcode'])

export function isPhiKey(key: string): boolean {
  const k = key.toLowerCase()
  if (SAFE_KEYS.has(k)) return false
  return PHI_KEYS.has(k)
}

const TEXT_PATTERNS: [RegExp, string][] = [
  // email addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  // US SSN
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  // card numbers (13–19 digits, optional separators)
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD]'],
  // phone numbers: +1 (555) 010-1234, 555.010.1234, 5550101234
  [/(?:\+?\d{1,2}[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[PHONE]'],
  // quoted values after PHI-like keys in serialised objects / Prisma dumps:
  //   name: "Jane Doe"   "email":"x"   transcript: `...`
  [
    /\b(name|firstName|lastName|email|phone|dob|dateOfBirth|address|subjective|objective|assessment|plan|note|notes|transcript|summary|answers|diagnosis|password|token)(["']?\s*[:=]\s*)(["'`])((?:\\.|(?!\3).)*)\3/gi,
    `$1$2$3${REDACTED}$3`,
  ],
]

export function scrubText(text: string): string {
  let out = text
  for (const [re, replacement] of TEXT_PATTERNS) out = out.replace(re, replacement)
  return out
}

/** Deep-scrubs a value. Never throws; cycles and depth are bounded. */
export function scrubPhi<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (value == null) return value
  if (typeof value === 'string') return scrubText(value) as unknown as T
  if (typeof value !== 'object') return value
  if (depth > 8) return '[TRUNCATED]' as unknown as T
  if (seen.has(value as object)) return '[CIRCULAR]' as unknown as T
  seen.add(value as object)

  if (value instanceof Error) {
    const e = new Error(scrubText(value.message))
    e.name = value.name
    e.stack = value.stack ? scrubText(value.stack) : undefined
    return e as unknown as T
  }
  if (value instanceof Date) return value
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => scrubPhi(v, depth + 1, seen)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] =
      isPhiKey(k) && v != null && typeof v !== 'boolean' ? REDACTED : scrubPhi(v, depth + 1, seen)
  }
  return out as T
}

/** URL safe to log: path kept, every query-string value masked. */
export function scrubUrl(url: string): string {
  const q = url.indexOf('?')
  if (q === -1) return scrubText(url)
  const path = url.slice(0, q)
  const params = url
    .slice(q + 1)
    .split('&')
    .map((pair) => `${pair.split('=')[0]}=${REDACTED}`)
    .join('&')
  return `${scrubText(path)}?${params}`
}

let consoleInstalled = false

/**
 * Wraps console.log/info/warn/error/debug so every argument is scrubbed
 * before it reaches stdout/stderr (and therefore the host's log drain).
 * Defence in depth for the many existing console.* call sites.
 */
export function installConsoleScrubber(): void {
  if (consoleInstalled) return
  consoleInstalled = true
  const target = console as unknown as Record<string, (...args: unknown[]) => void>
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = target[level]!.bind(target)
    target[level] = (...args: unknown[]) => original(...args.map((a) => scrubPhi(a)))
  }
}

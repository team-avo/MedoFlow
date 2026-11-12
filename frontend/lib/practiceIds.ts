/**
 * Practice identifiers collected during clinic onboarding: NPI, EIN and DEA
 * registration numbers, plus the US state list. These are format and checksum
 * checks only — nothing is looked up against an external registry; the
 * platform reviewer verifies the numbers before approving a clinic.
 *
 * Mirror of backend/src/utils/practiceIds.ts — keep the two identical. Both
 * test suites load shared/validation-cases/practice-ids.json.
 */

const digitsOnly = (v: string) => v.replace(/[\s-]/g, '')

/** Normalise an NPI as typed ("1234 567 893") to its 10 digits. */
export function normalizeNpi(value: string): string {
  return digitsOnly(value)
}

/**
 * National Provider Identifier: 10 digits whose last digit is a Luhn check
 * digit computed over the card-issuer prefix 80840 + the first 9 digits
 * (CMS NPI standard). The prefix contributes a constant 24 to the Luhn sum.
 */
export function isValidNpi(value: string): boolean {
  const npi = normalizeNpi(value)
  if (!/^\d{10}$/.test(npi)) return false
  let sum = 24
  // Walk the first 9 digits right-to-left, doubling every other one starting
  // with the rightmost (it sits next to the check digit).
  for (let i = 8, double = true; i >= 0; i--, double = !double) {
    let d = Number(npi[i])
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(npi[9])
}

/** Normalise an EIN to NN-NNNNNNN. Returns the input unchanged when it isn't 9 digits. */
export function normalizeEin(value: string): string {
  const d = digitsOnly(value)
  return /^\d{9}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2)}` : value.trim()
}

/**
 * Federal Employer Identification Number: 9 digits, written NN-NNNNNNN. The
 * IRS never issues the 00 prefix, and a number of one repeated digit is a
 * placeholder, not a real EIN.
 */
export function isValidEin(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\d{2}-?\d{7}$/.test(trimmed)) return false
  const d = digitsOnly(trimmed)
  if (d.startsWith('00')) return false
  if (/^(\d)\1{8}$/.test(d)) return false
  return true
}

/** Normalise a DEA number to upper case with no spaces. */
export function normalizeDea(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

/**
 * DEA registration number: 2 letters + 7 digits. The first letter is the
 * registrant type; the second is the registrant's last-name initial (or 9 for
 * business names). Check: (d1 + d3 + d5) + 2 × (d2 + d4 + d6) ends in d7.
 */
export function isValidDea(value: string): boolean {
  const dea = normalizeDea(value)
  const m = /^([ABCDEFGHJKLMPRSTUX])([A-Z9])(\d{7})$/.exec(dea)
  if (!m) return false
  const [d1, d2, d3, d4, d5, d6, d7] = m[3]!.split('').map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const total = d1 + d3 + d5 + 2 * (d2 + d4 + d6)
  return total % 10 === d7
}

/** Last 4 characters of a sensitive identifier, the rest masked. */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) return null
  const clean = value.replace(/[\s-]/g, '')
  if (clean.length <= 4) return '•'.repeat(clean.length)
  return `${'•'.repeat(clean.length - 4)}${clean.slice(-4)}`
}

/** US states, DC and territories: two-letter USPS codes. */
export const US_STATES = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'],
  ['GU', 'Guam'],
  ['VI', 'U.S. Virgin Islands'],
  ['AS', 'American Samoa'],
  ['MP', 'Northern Mariana Islands'],
] as const

export const US_STATE_CODES: readonly string[] = US_STATES.map(([code]) => code)

/** Practice types offered on the application (stored as the key). */
export const PRACTICE_TYPES = [
  ['MEDICAL_PRACTICE', 'Medical practice'],
  ['FUNCTIONAL_MEDICINE', 'Functional / integrative medicine'],
  ['NATUROPATHIC', 'Naturopathic'],
  ['CHIROPRACTIC', 'Chiropractic'],
  ['MED_SPA', 'Med spa / aesthetics'],
  ['PHYSICAL_THERAPY', 'Physical therapy'],
  ['WELLNESS_CENTER', 'Wellness center'],
  ['PHARMACY', 'Pharmacy'],
  // CTO-06: the CTO's core market.
  ['LONGEVITY_MEDICAL', 'Longevity medical practice'],
  ['OTHER', 'Other'],
] as const

export const PRACTICE_TYPE_KEYS: readonly string[] = PRACTICE_TYPES.map(([key]) => key)

/**
 * Title options for practitioners and the agreement signer (CTO-16). US
 * practices use these, not "Owner". "Other" takes free text. Mirrored on both
 * sides and checked against shared/validation-cases/practice-lists.json.
 */
export const PRACTITIONER_TITLES = [
  'Founder',
  'CEO',
  'Medical Director',
  'Physician',
  'Nurse Practitioner',
  'Practice Manager',
  'Other',
] as const

// ─── Practice type "Other" (CTO-18) ─────────────────────────────────────────

/** Typed practice type when "Other" is chosen: 2 to 80 characters, trimmed. */
export function isValidPracticeTypeOther(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  return v.length >= 2 && v.length <= 80
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]!
}

const normalizeWords = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const STOP_WORDS = new Set(['medical', 'practice', 'medicine', 'center', 'clinic', 'and'])

/**
 * The listed practice type a typed "Other" name most likely means, or null
 * (CTO-18). Case-insensitive; tolerates a small typo ("longevitty"). Typed
 * names are never added to the list automatically: a platform admin sees them
 * on the review screen and can promote one with a code change.
 */
export function closestPracticeType(typed: string): string | null {
  const words = normalizeWords(typed)
  if (words.length === 0) return null
  const phrase = words.join(' ')
  let best: { key: string; score: number } | null = null
  for (const [key, label] of PRACTICE_TYPES) {
    if (key === 'OTHER') continue
    const labelWords = normalizeWords(label)
    const labelPhrase = labelWords.join(' ')
    const candidates = [labelPhrase, key.toLowerCase().replace(/_/g, ' ')]
    let score = Math.min(...candidates.map((c) => editDistance(phrase, c)))
    // A distinctive word of the label typed on its own ("longevitty", "chiro").
    for (const w of words) {
      if (w.length < 5 || STOP_WORDS.has(w)) continue
      for (const lw of labelWords) {
        if (lw.length < 5 || STOP_WORDS.has(lw)) continue
        if (lw.startsWith(w) || editDistance(w, lw) <= 2) score = Math.min(score, 1)
      }
    }
    if (score <= 2 && (!best || score < best.score)) best = { key, score }
  }
  return best?.key ?? null
}

// ─── US addresses (CTO-22) ──────────────────────────────────────────────────

/** A US ZIP or ZIP+4. */
export const US_ZIP = /^\d{5}(-\d{4})?$/

export const isValidUsZip = (value: string | null | undefined) => US_ZIP.test((value ?? '').trim())

/** First three ZIP digits per state (USPS ranges). Used for a warning only. */
const ZIP3_RANGES: Record<string, Array<[number, number]>> = {
  AL: [[350, 369]],
  AK: [[995, 999]],
  AZ: [[850, 865]],
  AR: [[716, 729]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DE: [[197, 199]],
  DC: [
    [200, 205],
    [569, 569],
  ],
  FL: [[320, 349]],
  GA: [
    [300, 319],
    [398, 399],
  ],
  HI: [[967, 968]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  IA: [[500, 528]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  ME: [[39, 49]],
  MD: [[206, 219]],
  MA: [
    [10, 27],
    [55, 55],
  ],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MS: [[386, 397]],
  MO: [[630, 658]],
  MT: [[590, 599]],
  NE: [[680, 693]],
  NV: [[889, 898]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NY: [
    [5, 5],
    [100, 149],
  ],
  NC: [[270, 289]],
  ND: [[580, 588]],
  OH: [[430, 459]],
  OK: [[730, 749]],
  OR: [[970, 979]],
  PA: [[150, 196]],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [
    [733, 733],
    [750, 799],
    [885, 885],
  ],
  UT: [[840, 847]],
  VT: [[50, 59]],
  VA: [
    [201, 201],
    [220, 246],
  ],
  WA: [[980, 994]],
  WV: [[247, 268]],
  WI: [[530, 549]],
  WY: [[820, 831]],
  PR: [
    [6, 7],
    [9, 9],
  ],
  VI: [[8, 8]],
  GU: [[969, 969]],
  AS: [[967, 967]],
  MP: [[969, 969]],
}

/**
 * True when a valid ZIP doesn't belong to the chosen state. A warning, never
 * a block: ranges have exceptions, and nothing here calls a paid service.
 */
export function zipStateMismatch(
  zip: string | null | undefined,
  state: string | null | undefined
): boolean {
  const z = (zip ?? '').trim()
  const s = (state ?? '').trim().toUpperCase()
  const ranges = ZIP3_RANGES[s]
  if (!US_ZIP.test(z) || !ranges) return false
  const prefix = Number(z.slice(0, 3))
  return !ranges.some(([lo, hi]) => prefix >= lo && prefix <= hi)
}

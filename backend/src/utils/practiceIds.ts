/**
 * Practice identifiers collected during clinic onboarding: NPI, EIN and DEA
 * registration numbers, plus the US state list. These are format and checksum
 * checks only — nothing is looked up against an external registry; the
 * platform reviewer verifies the numbers before approving a clinic.
 *
 * Mirrored by frontend/lib/practiceIds.ts. Both test suites load the same
 * cases from shared/validation-cases/practice-ids.json, so keep them in step.
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

/** US states, DC and territories — two-letter USPS codes. */
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

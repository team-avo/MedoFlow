/**
 * Clinic onboarding application (practice details, practitioners, signed
 * agreement) and the platform review decision.
 *
 * Field set adapted from a wholesale clinic-account application: legal name /
 * DBA, locations, contacts, group NPI (or "no NPI"), federal tax ID, state
 * license, DEA, a repeatable practitioner list with an owner on record, and a
 * typed-signature authorization. Mirrored by frontend/lib/schemas/onboarding.ts.
 */
import { z } from 'zod'
import { IANAZone } from 'luxon'
import {
  isValidDea,
  isValidEin,
  isValidNpi,
  normalizeDea,
  normalizeEin,
  normalizeNpi,
  PRACTICE_TYPE_KEYS,
  US_STATE_CODES,
} from '../utils/practiceIds'

const requiredText = (label: string, max = 200) =>
  z.string().trim().min(2, `${label} is required`).max(max, `${label} is too long`)

/**
 * An optional field: '', null and a missing key all mean "not given" (null).
 * A value must pass `check`, with its own message. Built on preprocess +
 * refine rather than a union, so a bad value reports "Enter a valid NPI", not
 * zod's generic "Invalid input".
 */
const blankable = (
  check: (v: string) => boolean,
  message: string,
  normalize: (v: string) => string = (v) => v
) =>
  z
    .preprocess((v) => (v === null || v === undefined ? '' : v), z.string().trim())
    .refine((v) => !v || check(v), message)
    .transform((v) => (v ? normalize(v) : null))

/** Optional free text up to `max` characters. */
const optionalText = (max: number) =>
  blankable((v) => v.length <= max, `Keep it under ${max} characters`)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const email = z.string().trim().toLowerCase().regex(EMAIL, 'Enter a valid email')
const optionalEmail = blankable(
  (v) => EMAIL.test(v),
  'Enter a valid email',
  (v) => v.toLowerCase()
)

const PHONE = /^[+()\d\s.-]{7,25}$/
const optionalPhone = blankable((v) => PHONE.test(v), 'Enter a valid phone number')

const isState = (v: string) => US_STATE_CODES.includes(v.toUpperCase())
const state = z
  .string()
  .trim()
  .refine(isState, 'Choose a US state')
  .transform((v) => v.toUpperCase())
const optionalState = blankable(isState, 'Choose a US state', (v) => v.toUpperCase())

const ZIP = /^\d{5}(-\d{4})?$/
const zip = z.string().trim().regex(ZIP, 'Enter a 5-digit ZIP code')
const optionalZip = blankable((v) => ZIP.test(v), 'Enter a 5-digit ZIP code')

/** "www.clinic.com" or "https://clinic.com" → a normalised https URL. */
function toWebsite(v: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    return url.hostname.includes('.') && v.length <= 200 ? url.toString() : null
  } catch {
    return null
  }
}
const website = blankable(
  (v) => toWebsite(v) !== null,
  'Enter a valid website address',
  (v) => toWebsite(v)!
)

const optionalNpi = blankable(isValidNpi, 'Enter a valid 10-digit NPI', normalizeNpi)

// ─── Step 1: practice details ───────────────────────────────────────────────

export const practiceDetailsBody = z
  .object({
    legalName: requiredText('Legal name of practice'),
    dbaName: optionalText(200),
    practiceType: z.enum(PRACTICE_TYPE_KEYS as [string, ...string[]], {
      message: 'Choose a practice type',
    }),
    locationCount: z.coerce.number().int().min(1).max(500),

    // Primary location (written to the clinic's first location)
    addressLine1: requiredText('Street address'),
    addressLine2: optionalText(200),
    city: requiredText('City', 100),
    state,
    postalCode: zip,
    timezone: z
      .string()
      .trim()
      .refine((tz) => IANAZone.isValidZone(tz), 'Choose a timezone'),
    officePhone: optionalPhone,
    fax: optionalPhone,
    website,

    // Contacts
    primaryContactName: requiredText('Primary contact name'),
    primaryContactEmail: email,
    primaryContactPhone: optionalPhone,
    officeManagerName: optionalText(200),
    officeManagerEmail: optionalEmail,
    accountsPayableName: optionalText(200),
    accountsPayableEmail: optionalEmail,

    // Mailing / billing address
    mailingSameAsPrimary: z.boolean(),
    mailingAddressLine1: optionalText(200),
    mailingAddressLine2: optionalText(200),
    mailingCity: optionalText(100),
    mailingState: optionalState,
    mailingPostalCode: optionalZip,

    // Regulatory identifiers
    noNpi: z.boolean(),
    groupNpi: optionalNpi,
    /** Omitted on an edit = keep the number on file (the API only returns it masked). */
    federalTaxId: z
      .string()
      .trim()
      .refine(isValidEin, 'Enter a valid EIN (NN-NNNNNNN)')
      .transform(normalizeEin)
      .optional(),
    licenseNumber: optionalText(50),
    licenseState: optionalState,
    /** Omitted = keep; null or '' = remove; a value = set. */
    deaNumber: z
      .preprocess((v) => (v === null ? '' : v), z.string().trim().optional())
      .refine((v) => !v || isValidDea(v), 'Enter a valid DEA number (2 letters + 7 digits)')
      .transform((v) => (v === undefined ? undefined : v ? normalizeDea(v) : null)),

    // About the account
    estimatedSeats: z.coerce.number().int().min(1).max(1000),
    referralSource: optionalText(200),
    salesRep: optionalText(100),
  })
  .superRefine((v, ctx) => {
    if (!v.noNpi && !v.groupNpi) {
      ctx.addIssue({
        code: 'custom',
        path: ['groupNpi'],
        message: 'Enter your group NPI, or tick "I don\'t have an NPI"',
      })
    }
    if (!v.mailingSameAsPrimary) {
      const required = [
        ['mailingAddressLine1', 'Mailing street address'],
        ['mailingCity', 'Mailing city'],
        ['mailingState', 'Mailing state'],
        ['mailingPostalCode', 'Mailing ZIP code'],
      ] as const
      for (const [key, label] of required) {
        if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${label} is required` })
      }
    }
  })

export type PracticeDetailsInput = z.infer<typeof practiceDetailsBody>
export const practiceDetailsSchema = { body: practiceDetailsBody }

// ─── Step 2: practitioners ──────────────────────────────────────────────────

export const practitionerBody = z.object({
  name: requiredText('Name', 100),
  email,
  phone: optionalPhone,
  credentials: optionalText(30),
  licenseNumber: optionalText(50),
  licenseState: optionalState,
  npi: optionalNpi,
  /** Founder, CEO, Medical Director… (PRACTITIONER_TITLES) or free text (CTO-16). */
  title: optionalText(80),
  isOwner: z.boolean(),
  isSelf: z.boolean(),
  /** Only meaningful on the owner's own row (CTO-14): false for a non-clinical owner. */
  seesPatients: z.boolean().optional().default(true),
})

export type PractitionerInput = z.infer<typeof practitionerBody>

export const practitionersBody = z
  .object({
    practitioners: z
      .array(practitionerBody)
      .min(1, 'Add at least one practitioner')
      .max(20, 'Add up to 20 practitioners here; invite the rest from the Team page'),
  })
  .superRefine((v, ctx) => {
    const owners = v.practitioners.filter((p) => p.isOwner).length
    if (owners !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['practitioners'],
        message: 'Mark exactly one practitioner as the primary account holder',
      })
    }
    if (v.practitioners.filter((p) => p.isSelf).length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['practitioners'],
        message: 'Only one practitioner can be you',
      })
    }
    const seen = new Set<string>()
    v.practitioners.forEach((p, i) => {
      if (seen.has(p.email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['practitioners', i, 'email'],
          message: 'Each practitioner needs their own email',
        })
      }
      seen.add(p.email)
    })
  })

export const practitionersSchema = { body: practitionersBody }

// ─── Step 3: agreement + signature ──────────────────────────────────────────

export const ACKNOWLEDGEMENT_KEYS = [
  'baa',
  'hipaa',
  'dataResidency',
  'refundPolicy',
  'authorizedSignatory',
] as const

export const agreementBody = z.object({
  acknowledgements: z.object({
    baa: z.boolean(),
    hipaa: z.boolean(),
    dataResidency: z.boolean(),
    refundPolicy: z.boolean(),
    authorizedSignatory: z.boolean(),
  }),
  /** "I authorize MedoFlow to contact the practice by email, phone, fax and mail." */
  communications: z.boolean(),
  signerName: requiredText('Your full name'),
  signerTitle: requiredText('Your title', 100),
  /** Typed signature — must match signerName. */
  signature: requiredText('Signature'),
  /** Required only when ONBOARDING_CONFIRM_NAME is on (CTO-10); checked in the service. */
  confirmClinicName: z.string().trim().max(200).optional(),
})

export type AgreementInput = z.infer<typeof agreementBody>
export const agreementSchema = { body: agreementBody }

// ─── Platform review ────────────────────────────────────────────────────────

export const reviewDecisionSchema = {
  params: z.object({ tenantId: z.string().min(1) }),
  body: z
    .object({
      decision: z.enum(['APPROVE', 'REQUEST_CHANGES', 'REJECT']),
      notes: z.string().trim().max(2000).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.decision !== 'APPROVE' && (!v.notes || v.notes.length < 5)) {
        ctx.addIssue({
          code: 'custom',
          path: ['notes'],
          message: 'Tell the clinic what needs to change (at least 5 characters)',
        })
      }
    }),
}

export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema.body>
